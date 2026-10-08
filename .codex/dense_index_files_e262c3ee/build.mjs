import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "D:\\project-mobile application\\outputs\\dense_index_files_e262c3ee";
const outputPath = `${outputDir}\\Dense_Index_files.xlsx`;
const previewDir = outputDir;
const fontFamily = "Arial";

const colors = {
  purple: "#7030A0",
  purpleDark: "#54257B",
  purpleLight: "#EADCF8",
  blueDark: "#1F4E78",
  blue: "#DDEBF7",
  blueAlt: "#EAF3F8",
  ink: "#1F2937",
  muted: "#5B6573",
  line: "#7F8C8D",
  softLine: "#C9D2D9",
  white: "#FFFFFF",
  note: "#FFF2CC",
};

const records = [
  [1, 76766, "Crick", "Biology", 72000],
  [2, 10101, "Srinivasan", "Comp. Sci.", 65000],
  [3, 45565, "Katz", "Comp. Sci.", 75000],
  [4, 83821, "Brandt", "Comp. Sci.", 92000],
  [5, 98345, "Kim", "Elec. Eng.", 80000],
  [6, 12121, "Wu", "Finance", 90000],
  [7, 76543, "Singh", "Finance", 80000],
  [8, 32343, "El Said", "History", 60000],
  [9, 58583, "Califieri", "History", 62000],
  [10, 15151, "Mozart", "Music", 40000],
  [11, 22222, "Einstein", "Physics", 95000],
  [12, 33465, "Gold", "Physics", 87000],
];

const departments = [
  "Biology",
  "Comp. Sci.",
  "Elec. Eng.",
  "Finance",
  "History",
  "Music",
  "Physics",
];

await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const dense = workbook.worksheets.add("Dense Index");
const file = workbook.worksheets.add("Instructor File");

function applyBase(sheet, rangeAddress) {
  const range = sheet.getRange(rangeAddress);
  range.format.font = { name: fontFamily, size: 11, color: colors.ink };
  range.format.verticalAlignment = "center";
  return range;
}

function applyTitle(sheet, mergeAddress, title, subtitleAddress, subtitle) {
  sheet.mergeCells(mergeAddress);
  const titleRange = sheet.getRange(mergeAddress);
  titleRange.values = [[title]];
  titleRange.format.font = { name: fontFamily, size: 22, bold: true, color: colors.purple };
  titleRange.format.horizontalAlignment = "left";
  titleRange.format.verticalAlignment = "center";
  titleRange.format.rowHeight = 34;

  sheet.mergeCells(subtitleAddress);
  const subtitleRange = sheet.getRange(subtitleAddress);
  subtitleRange.values = [[subtitle]];
  subtitleRange.format.font = { name: fontFamily, size: 11, italic: true, color: colors.muted };
  subtitleRange.format.horizontalAlignment = "left";
  subtitleRange.format.verticalAlignment = "center";
  subtitleRange.format.rowHeight = 25;
}

function styleHeader(range) {
  range.format.fill = colors.blueDark;
  range.format.font = { name: fontFamily, size: 10, bold: true, color: colors.white };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.wrapText = true;
  range.format.borders = { preset: "all", style: "thin", color: colors.white };
  range.format.rowHeight = 28;
}

function styleBody(range, fill = colors.blue) {
  range.format.fill = fill;
  range.format.borders = { preset: "all", style: "thin", color: colors.softLine };
  range.format.verticalAlignment = "center";
}

function addOutsideBorder(range, style = "medium", color = colors.line) {
  range.format.borders = {
    top: { style, color },
    bottom: { style, color },
    left: { style, color },
    right: { style, color },
    insideHorizontal: { style: "thin", color: colors.softLine },
    insideVertical: { style: "thin", color: colors.softLine },
  };
}

// Dense Index sheet: a compact native-cell recreation of the reference diagram.
dense.showGridLines = false;
applyBase(dense, "A1:L27");
applyTitle(
  dense,
  "A1:L1",
  "Dense Index files",
  "A2:L2",
  "Dense index on dept_name, with instructor file sorted on dept_name",
);

dense.getRange("A4:D4").values = [["Dense index", null, null, null]];
dense.mergeCells("A4:D4");
dense.getRange("A4:D4").format.fill = colors.purple;
dense.getRange("A4:D4").format.font = { name: fontFamily, size: 12, bold: true, color: colors.white };
dense.getRange("A4:D4").format.horizontalAlignment = "left";
dense.getRange("A4:D4").format.rowHeight = 23;

dense.getRange("A5:D5").values = [["dept_name", "first_record_id", "file_position", "pointer"]];
styleHeader(dense.getRange("A5:D5"));
dense.getRange("A6:A12").values = departments.map((department) => [department]);
dense.getRange("B6").formulas = [["=INDEX('Instructor File'!$B$5:$B$16,MATCH(A6,'Instructor File'!$D$5:$D$16,0))"]];
dense.getRange("B6:B12").fillDown();
dense.getRange("C6").formulas = [["=MATCH(A6,'Instructor File'!$D$5:$D$16,0)"]];
dense.getRange("C6:C12").fillDown();
dense.getRange("D6:D12").values = departments.map(() => ["→"]);
styleBody(dense.getRange("A6:D12"), colors.purpleLight);
dense.getRange("A6:A12").format.horizontalAlignment = "left";
dense.getRange("B6:C12").format.horizontalAlignment = "right";
dense.getRange("D6:D12").format.horizontalAlignment = "center";
dense.getRange("D6:D12").format.font = { name: fontFamily, size: 15, bold: true, color: colors.purpleDark };
addOutsideBorder(dense.getRange("A5:D12"));

dense.getRange("F4:K4").values = [["Instructor file (sorted by dept_name)", null, null, null, null, null]];
dense.mergeCells("F4:K4");
dense.getRange("F4:K4").format.fill = colors.blueDark;
dense.getRange("F4:K4").format.font = { name: fontFamily, size: 12, bold: true, color: colors.white };
dense.getRange("F4:K4").format.horizontalAlignment = "left";
dense.getRange("F4:K4").format.rowHeight = 23;

dense.getRange("F5:K5").values = [["file_position", "instructor_id", "name", "dept_name", "salary", "next_record_id"]];
styleHeader(dense.getRange("F5:K5"));

const previewSourceColumns = ["A", "B", "C", "D", "E", "F"];
const previewTargetColumns = ["F", "G", "H", "I", "J", "K"];
for (let i = 0; i < previewSourceColumns.length; i += 1) {
  const firstFormula = i === 5
    ? `=IF('Instructor File'!F5=0,"",'Instructor File'!F5)`
    : `='Instructor File'!${previewSourceColumns[i]}5`;
  dense.getRange(`${previewTargetColumns[i]}6`).formulas = [[firstFormula]];
  dense.getRange(`${previewTargetColumns[i]}6:${previewTargetColumns[i]}17`).fillDown();
}
styleBody(dense.getRange("F6:K17"), colors.blue);
dense.getRange("F6:F17").format.horizontalAlignment = "right";
dense.getRange("G6:G17").format.horizontalAlignment = "right";
dense.getRange("H6:I17").format.horizontalAlignment = "left";
dense.getRange("J6:K17").format.horizontalAlignment = "right";
dense.getRange("J6:J17").format.font = { name: fontFamily, size: 11, bold: true, color: colors.blueDark };
dense.getRange("K6:K17").format.font = { name: fontFamily, size: 10, color: colors.muted };
dense.getRange("J6:J17").format.fill = colors.blueAlt;
dense.getRange("J6:J17").format.numberFormat = "#,##0";
addOutsideBorder(dense.getRange("F5:K17"));

dense.getRange("A20:K20").values = [["Interpretation", null, null, null, null, null, null, null, null, null, null]];
dense.mergeCells("A20:K20");
dense.getRange("A20:K20").format.fill = colors.note;
dense.getRange("A20:K20").format.font = { name: fontFamily, size: 11, bold: true, color: colors.ink };
dense.getRange("A20:K20").format.horizontalAlignment = "left";

dense.getRange("A21:B23").values = [
  ["1", "One index entry exists for each distinct dept_name."],
  ["2", "first_record_id points to the first instructor row for that department."],
  ["3", "next_record_id links duplicate dept_name rows; blank ends the chain."],
];
dense.mergeCells("B21:K21");
dense.mergeCells("B22:K22");
dense.mergeCells("B23:K23");
dense.getRange("A21:A23").format.font = { name: fontFamily, size: 11, bold: true, color: colors.purpleDark };
dense.getRange("A21:A23").format.horizontalAlignment = "center";
dense.getRange("B21:K23").format.font = { name: fontFamily, size: 10, color: colors.ink };
dense.getRange("B21:K23").format.horizontalAlignment = "left";
dense.getRange("B21:K23").format.wrapText = true;
dense.getRange("A21:K23").format.rowHeight = 23;

dense.getRange("A25:K25").values = [["Reference: values reproduced from the user-provided Dense Index diagram.", null, null, null, null, null, null, null, null, null, null]];
dense.mergeCells("A25:K25");
dense.getRange("A25:K25").format.font = { name: fontFamily, size: 9, italic: true, color: colors.muted };
dense.getRange("A25:K25").format.horizontalAlignment = "left";

dense.getRange("A1:A27").format.columnWidth = 18;
dense.getRange("B1:B27").format.columnWidth = 15;
dense.getRange("C1:C27").format.columnWidth = 12;
dense.getRange("D1:D27").format.columnWidth = 9;
dense.getRange("E1:E27").format.columnWidth = 3;
dense.getRange("F1:F27").format.columnWidth = 12;
dense.getRange("G1:G27").format.columnWidth = 14;
dense.getRange("H1:H27").format.columnWidth = 15;
dense.getRange("I1:I27").format.columnWidth = 15;
dense.getRange("J1:J27").format.columnWidth = 12;
dense.getRange("K1:K27").format.columnWidth = 15;
dense.getRange("L1:L27").format.columnWidth = 3;
dense.getRange("A1:L2").format.rowHeight = 28;
dense.getRange("A6:K18").format.rowHeight = 22;
dense.freezePanes.freezeRows(5);
dense.tabColor = colors.purple;

// Instructor File sheet: editable raw rows and a formula-driven next-record pointer.
file.showGridLines = false;
applyBase(file, "A1:F20");
applyTitle(
  file,
  "A1:F1",
  "Instructor File",
  "A2:F2",
  "Records sorted by dept_name; next_record_id links consecutive records in the same department",
);
file.getRange("A4:F4").values = [["file_position", "instructor_id", "name", "dept_name", "salary", "next_record_id"]];
styleHeader(file.getRange("A4:F4"));
file.getRange("A5:E16").values = records;
file.getRange("F5").formulas = [["=IF(D5=D6,B6,\"\")"]];
file.getRange("F5:F16").fillDown();
styleBody(file.getRange("A5:F16"), colors.blue);
file.getRange("A5:B16").format.horizontalAlignment = "right";
file.getRange("C5:D16").format.horizontalAlignment = "left";
file.getRange("E5:F16").format.horizontalAlignment = "right";
file.getRange("D5:D16").format.fill = colors.blueAlt;
file.getRange("F5:F16").format.font = { name: fontFamily, size: 11, color: colors.muted };
file.getRange("E5:E16").format.numberFormat = "#,##0";
addOutsideBorder(file.getRange("A4:F16"));

file.getRange("A18:F18").values = [["Data rule", "The data file stays sorted by dept_name so the dense index can point to the first record in each group.", null, null, null, null]];
file.mergeCells("B18:F18");
file.getRange("A18:F18").format.fill = colors.note;
file.getRange("A18:F18").format.font = { name: fontFamily, size: 10, color: colors.ink };
file.getRange("A18:A18").format.font = { name: fontFamily, size: 10, bold: true, color: colors.purpleDark };
file.getRange("B18:F18").format.wrapText = true;
file.getRange("A18:F18").format.rowHeight = 34;

file.getRange("A1:A20").format.columnWidth = 13;
file.getRange("B1:B20").format.columnWidth = 14;
file.getRange("C1:C20").format.columnWidth = 16;
file.getRange("D1:D20").format.columnWidth = 15;
file.getRange("E1:E20").format.columnWidth = 13;
file.getRange("F1:F20").format.columnWidth = 16;
file.getRange("A5:F16").format.rowHeight = 22;
file.freezePanes.freezeRows(4);
file.tabColor = colors.blueDark;

// Compact verification before export.
const denseCheck = await workbook.inspect({
  kind: "table",
  sheetId: "Dense Index",
  range: "A1:K20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 11,
  maxChars: 12000,
});
console.log("DENSE_CHECK\n" + denseCheck.ndjson);

const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan before export",
});
console.log("FORMULA_ERRORS\n" + formulaErrors.ndjson);

const previewDense = await workbook.render({ sheetName: "Dense Index", autoCrop: "all", scale: 1.2, format: "png" });
await fs.writeFile(`${previewDir}\\dense_index_preview.png`, new Uint8Array(await previewDense.arrayBuffer()));
const previewFile = await workbook.render({ sheetName: "Instructor File", autoCrop: "all", scale: 1.2, format: "png" });
await fs.writeFile(`${previewDir}\\instructor_file_preview.png`, new Uint8Array(await previewFile.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

// Re-open the exported file and run the final checks on the saved workbook.
const savedWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const savedDenseCheck = await savedWorkbook.inspect({
  kind: "table",
  sheetId: "Dense Index",
  range: "A5:K20",
  include: "values,formulas",
  tableMaxRows: 16,
  tableMaxCols: 11,
  maxChars: 10000,
});
console.log("SAVED_DENSE_CHECK\n" + savedDenseCheck.ndjson);
const savedFileCheck = await savedWorkbook.inspect({
  kind: "table",
  sheetId: "Instructor File",
  range: "A4:F18",
  include: "values,formulas",
  tableMaxRows: 15,
  tableMaxCols: 6,
  maxChars: 8000,
});
console.log("SAVED_FILE_CHECK\n" + savedFileCheck.ndjson);
const savedErrors = await savedWorkbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log("SAVED_FORMULA_ERRORS\n" + savedErrors.ndjson);

console.log(`EXPORTED ${outputPath}`);
