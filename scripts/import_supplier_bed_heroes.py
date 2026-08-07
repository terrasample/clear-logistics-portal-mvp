#!/usr/bin/env python3

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path


NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def load_shared_strings(workbook_zip):
    shared = []
    if "xl/sharedStrings.xml" not in workbook_zip.namelist():
        return shared

    root = ET.fromstring(workbook_zip.read("xl/sharedStrings.xml"))
    for si in root.findall("a:si", NS):
        text = "".join((t.text or "") for t in si.findall(".//a:t", NS))
        shared.append(text)
    return shared


def read_product_sheet_rows(workbook_zip, shared):
    root = ET.fromstring(workbook_zip.read("xl/worksheets/sheet2.xml"))
    rows = {}

    for row in root.findall(".//a:sheetData/a:row", NS):
        row_index = int(row.attrib["r"])
        values = {}

        for cell in row.findall("a:c", NS):
            ref = cell.attrib.get("r", "A1")
            col = "".join(ch for ch in ref if ch.isalpha())
            cell_type = cell.attrib.get("t")
            value_node = cell.find("a:v", NS)
            text = ""

            if cell_type == "s" and value_node is not None and (value_node.text or "").isdigit():
                index = int(value_node.text)
                text = shared[index] if index < len(shared) else ""
            elif cell_type == "inlineStr":
                text = "".join((t.text or "") for t in cell.findall(".//a:t", NS))
            elif value_node is not None and value_node.text is not None:
                text = value_node.text

            values[col] = text

        rows[row_index] = values

    return rows


def relationships(workbook_zip, rel_path):
    root = ET.fromstring(workbook_zip.read(rel_path))
    rels = {}
    for rel in root.findall("p:Relationship", NS):
        rels[rel.attrib["Id"]] = rel.attrib["Target"]
    return rels


def row_to_image_paths(workbook_zip):
    drawing_xml = "xl/drawings/drawing2.xml"
    drawing_rels = "xl/drawings/_rels/drawing2.xml.rels"

    if drawing_xml not in workbook_zip.namelist() or drawing_rels not in workbook_zip.namelist():
        return {}

    root = ET.fromstring(workbook_zip.read(drawing_xml))
    rels = relationships(workbook_zip, drawing_rels)
    mapping = defaultdict(list)

    anchors = root.findall("xdr:twoCellAnchor", NS) + root.findall("xdr:oneCellAnchor", NS)
    for anchor in anchors:
        from_node = anchor.find("xdr:from", NS)
        if from_node is None:
            continue

        row_zero_based = int(from_node.findtext("xdr:row", default="0", namespaces=NS))
        row_index = row_zero_based + 1

        blip = anchor.find(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip")
        if blip is None:
            continue

        rel_id = blip.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
        target = rels.get(rel_id, "")
        if target.startswith("../"):
            image_path = "xl/" + target[3:]
        elif target.startswith("xl/"):
            image_path = target
        else:
            image_path = "xl/drawings/" + target

        mapping[row_index].append(image_path)

    return dict(mapping)


def normalize_product_name(raw_name):
    return re.sub(r"\s+", " ", raw_name.replace("\n", " ")).strip()


def extract_set_code(product_name):
    # Accept codes like 2893A or 3006.
    match = re.search(r"\b(\d{4}[A-Za-z]?)\b", product_name)
    return match.group(1).upper() if match else ""


def is_bed_product(product_name):
    name = product_name.lower()
    lower_hits = ["bed", "床"]
    lower_excludes = [
        "nightstand",
        "bedstand",
        "bed end bench",
        "bench",
        "stool",
        "mirror",
        "table",
        "dresser",
        "cabinet",
        "wardrobe",
        "床头柜",
        "床前凳",
        "妆镜",
        "妆凳",
    ]

    if not any(token in name for token in lower_hits):
        return False

    if any(token in name for token in lower_excludes):
        return False

    return True


def main():
    repo_root = Path(__file__).resolve().parents[1]
    desktop_root = Path.home() / "Desktop"
    catalog_info_dir = desktop_root / "Catalog Info"

    xlsx_files = [
        catalog_info_dir / "国际站报价表-美国.xlsx",
        catalog_info_dir / "国际站报价表-美国 -沙发+床.xlsx",
    ]

    output_images_dir = repo_root / "public" / "catalog" / "supplier_bed_heroes"
    output_json_path = repo_root / "src" / "supplierBedHeroes.json"
    report_json_path = repo_root / "scripts" / "supplier_bed_hero_report.json"

    output_images_dir.mkdir(parents=True, exist_ok=True)

    hero_map = {}
    report_rows = []

    for workbook_path in xlsx_files:
        if not workbook_path.exists():
            continue

        with zipfile.ZipFile(workbook_path) as workbook_zip:
            shared = load_shared_strings(workbook_zip)
            rows = read_product_sheet_rows(workbook_zip, shared)
            image_mapping = row_to_image_paths(workbook_zip)

            for row_index, image_paths in sorted(image_mapping.items()):
                row_values = rows.get(row_index, {})
                product_name = normalize_product_name(row_values.get("C", ""))
                if not product_name:
                    continue

                set_code = extract_set_code(product_name)
                bed_candidate = is_bed_product(product_name)

                if not set_code or not bed_candidate:
                    continue

                for image_path in image_paths:
                    if image_path not in workbook_zip.namelist():
                        continue

                    output_name = f"{set_code}.png"
                    output_path = output_images_dir / output_name

                    if set_code not in hero_map:
                        output_path.write_bytes(workbook_zip.read(image_path))
                        hero_map[set_code] = f"/catalog/supplier_bed_heroes/{output_name}"

                    report_rows.append(
                        {
                            "workbook": workbook_path.name,
                            "row": row_index,
                            "setCode": set_code,
                            "productName": product_name,
                            "imagePath": image_path,
                            "selected": hero_map.get(set_code, "").endswith(output_name),
                        }
                    )
                    break

    ordered_map = {key: hero_map[key] for key in sorted(hero_map.keys())}
    output_json_path.write_text(json.dumps(ordered_map, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    report_json_path.write_text(json.dumps(report_rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {len(ordered_map)} supplier bed heroes to {output_json_path}")
    print(f"Images exported to {output_images_dir}")


if __name__ == "__main__":
    main()