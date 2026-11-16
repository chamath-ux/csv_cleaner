const fileInput = document.getElementById("fileInput");
const browseButton = document.getElementById("browseButton");
const message = document.getElementById("message");
const maxFileSize = 20 * 1024 * 1024;
const cleanButton = document.getElementById("cleanButton");
const cleanupDialog = document.getElementById("cleanupDialog");
const confirmCleanupButton = document.getElementById("confirmCleanupButton");
const cancelCleanupButton = document.getElementById("cancelCleanupButton");
let csvRows = null;
let pendingCleanup = null;

browseButton.addEventListener("click", () => fileInput.click());

cleanButton.addEventListener("click", () => {
  if (!csvRows) return;

  const trimmedRows = trimWhitespace(csvRows);
  const removedRows = trimmedRows
    .map((row, index) => ({ row, sourceRow: index + 1 }))
    .filter(({ row }) => isRowEmpty(row));
  const columnCount = csvRows.reduce((maximum, row) => Math.max(maximum, row.length), 0);

  pendingCleanup = {
    trimmedRows,
    removedRows,
    columnCount,
    selectedIndexes: new Set(removedRows.map((_, index) => index))
  };
  renderDialogRemovedRows(removedRows, columnCount);
  document.getElementById("dialogPreviewLimit").textContent =
    removedRows.length > 100 ? "Showing first 100 rows" : "";
  updateDialogSelection();
  cleanupDialog.showModal();
});

confirmCleanupButton.addEventListener("click", () => {
  if (!pendingCleanup) return;
  const removedRows = pendingCleanup.removedRows.filter((_, index) => pendingCleanup.selectedIndexes.has(index));
  const removedSourceRows = new Set(removedRows.map(({ sourceRow }) => sourceRow));
  const cleanedRows = pendingCleanup.trimmedRows.filter((_, index) => !removedSourceRows.has(index + 1));
  const cleanup = { cleanedRows, removedRows, columnCount: pendingCleanup.columnCount };
  pendingCleanup = null;
  cleanupDialog.close();
  applyCleanup(cleanup);
});

document.getElementById("dialogRemovedTable").addEventListener("change", (event) => {
  if (!pendingCleanup) return;

  if (event.target.matches("#selectAllRows")) {
    pendingCleanup.selectedIndexes = event.target.checked
      ? new Set(pendingCleanup.removedRows.map((_, index) => index))
      : new Set();
    document.querySelectorAll(".remove-row-checkbox").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
  } else if (event.target.matches(".remove-row-checkbox")) {
    const index = Number(event.target.dataset.removedIndex);
    if (event.target.checked) {
      pendingCleanup.selectedIndexes.add(index);
    } else {
      pendingCleanup.selectedIndexes.delete(index);
    }
  }
  updateDialogSelection();
});

cancelCleanupButton.addEventListener("click", () => cleanupDialog.close());
cleanupDialog.addEventListener("close", () => {
  pendingCleanup = null;
  cleanButton.focus();
});

function applyCleanup({ cleanedRows, removedRows, columnCount }) {
  document.getElementById("rowCount").textContent = String(cleanedRows.length);
  document.getElementById("columnCount").textContent = String(columnCount);
  document.getElementById("cleanedCount").textContent = String(removedRows.length);
  document.getElementById("previewSubtitle").textContent =
    `${cleanedRows.length} cleaned rows · ${removedRows.length} removed`;
  document.getElementById("previewBadge").textContent = "CLEANED DATA";
  document.getElementById("previewBadge").classList.add("ready");
  document.getElementById("previewCount").textContent =
    `Showing ${Math.min(cleanedRows.length, 100)} of ${cleanedRows.length} rows`;
  renderPreview(cleanedRows);
  renderRemovedRows(removedRows, columnCount);
  message.classList.add("success");
  message.textContent = `${removedRows.length} empty row(s) removed. Both results are shown in the preview.`;
  console.log("Cleaned CSV rows:", cleanedRows);
  console.log("Removed CSV rows:", removedRows);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  csvRows = null;
  cleanButton.disabled = true;

  let error = "";
  if (!file.name.toLowerCase().endsWith(".csv")) {
    error = "Please select a CSV file (.csv).";
  } else if (file.size === 0) {
    error = "The selected file is empty.";
  } else if (file.size > maxFileSize) {
    error = "The selected file is larger than 20 MB.";
  }

  message.textContent = error;
  message.classList.remove("success");
  if (error) {
    console.error("Invalid file:", error);
    return;
  }

  console.log("Selected file:", file);
  try {
    csvRows = await getRows(file);
    const rows = csvRows;
    const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    document.getElementById("rowCount").textContent = String(rows.length);
    document.getElementById("columnCount").textContent = String(columnCount);
    cleanButton.disabled = false;
    console.log("CSV rows:", rows);
  } catch (readError) {
    const readMessage = readError instanceof Error ? readError.message : "The CSV file could not be read.";
    message.textContent = readMessage;
    console.error("Could not read CSV rows:", readError);
  }
});

async function getRows(file) {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (inQuotes) {
      if (character === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("The CSV contains an unclosed quoted field.");
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function trimWhitespace(rows) {
  return rows.map((row) => row.map((cell) => cell.trim()));
}

function removeEmptyRows(rows) {
  return rows.filter((row) => !isRowEmpty(row));
}

function isRowEmpty(row) {
  return row.some((cell) => String(cell ?? "").trim() === "");
}

function renderPreview(rows) {
  const emptyState = document.getElementById("emptyState");
  const table = document.getElementById("previewTable");
  const tableHead = document.getElementById("tableHead");
  const tableBody = document.getElementById("tableBody");
  tableHead.replaceChildren();
  tableBody.replaceChildren();

  if (rows.length === 0) {
    emptyState.hidden = false;
    emptyState.querySelector("strong").textContent = "No rows left after cleanup";
    emptyState.querySelector("span").textContent = "There is no data to preview.";
    table.hidden = true;
    return;
  }

  emptyState.hidden = true;
  table.hidden = false;

  const header = document.createElement("tr");
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  for (let column = 0; column < columnCount; column += 1) {
    const heading = document.createElement("th");
    heading.textContent = `COLUMN ${column + 1}`;
    header.appendChild(heading);
  }
  tableHead.appendChild(header);

  rows.slice(0, 100).forEach((row) => {
    const tableRow = document.createElement("tr");
    for (let column = 0; column < columnCount; column += 1) {
      const cell = document.createElement("td");
      cell.textContent = row[column] || "";
      tableRow.appendChild(cell);
    }
    tableBody.appendChild(tableRow);
  });
}

function renderRemovedRows(rows, columnCount) {
  const section = document.getElementById("removedSection");
  const count = document.getElementById("removedCount");
  const emptyMessage = document.getElementById("removedEmptyMessage");
  const table = document.getElementById("removedTable");
  const tableHead = document.getElementById("removedTableHead");
  const tableBody = document.getElementById("removedTableBody");

  section.hidden = false;
  count.textContent = String(rows.length);
  tableHead.replaceChildren();
  tableBody.replaceChildren();
  emptyMessage.hidden = rows.length > 0;
  table.hidden = rows.length === 0;
  if (rows.length === 0) return;

  const header = document.createElement("tr");
  const sourceHeading = document.createElement("th");
  sourceHeading.textContent = "CSV ROW";
  header.appendChild(sourceHeading);
  for (let column = 0; column < columnCount; column += 1) {
    const heading = document.createElement("th");
    heading.textContent = `COLUMN ${column + 1}`;
    header.appendChild(heading);
  }
  tableHead.appendChild(header);

  rows.slice(0, 100).forEach(({ row, sourceRow }) => {
    const tableRow = document.createElement("tr");
    const sourceCell = document.createElement("td");
    sourceCell.textContent = String(sourceRow);
    tableRow.appendChild(sourceCell);
    for (let column = 0; column < columnCount; column += 1) {
      const cell = document.createElement("td");
      cell.textContent = row[column] || "";
      tableRow.appendChild(cell);
    }
    tableBody.appendChild(tableRow);
  });
}

function renderDialogRemovedRows(rows, columnCount) {
  const emptyMessage = document.getElementById("dialogEmptyMessage");
  const table = document.getElementById("dialogRemovedTable");
  const tableHead = document.getElementById("dialogRemovedTableHead");
  const tableBody = document.getElementById("dialogRemovedTableBody");

  tableHead.replaceChildren();
  tableBody.replaceChildren();
  emptyMessage.hidden = rows.length > 0;
  table.hidden = rows.length === 0;
  if (rows.length === 0) return;

  const header = document.createElement("tr");
  const selectAllHeading = document.createElement("th");
  const selectAll = document.createElement("input");
  selectAll.type = "checkbox";
  selectAll.id = "selectAllRows";
  selectAll.className = "row-select-checkbox";
  selectAll.setAttribute("aria-label", "Select all empty rows for removal");
  selectAll.checked = true;
  selectAllHeading.appendChild(selectAll);
  header.appendChild(selectAllHeading);
  const labels = ["CSV ROW"];
  for (let column = 0; column < columnCount; column += 1) {
    labels.push(`COLUMN ${column + 1}`);
  }
  labels.forEach((label) => {
    const heading = document.createElement("th");
    heading.textContent = label;
    header.appendChild(heading);
  });
  tableHead.appendChild(header);

  rows.slice(0, 100).forEach(({ row, sourceRow }, index) => {
    const tableRow = document.createElement("tr");
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "row-select-checkbox remove-row-checkbox";
    checkbox.dataset.removedIndex = String(index);
    checkbox.setAttribute("aria-label", `Select CSV row ${sourceRow} for removal`);
    checkbox.checked = true;
    selectCell.appendChild(checkbox);
    tableRow.appendChild(selectCell);

    const sourceCell = document.createElement("td");
    sourceCell.textContent = String(sourceRow);
    tableRow.appendChild(sourceCell);
    for (let column = 0; column < columnCount; column += 1) {
      const cell = document.createElement("td");
      cell.textContent = row[column] || "(empty)";
      tableRow.appendChild(cell);
    }
    tableBody.appendChild(tableRow);
  });
}

function updateDialogSelection() {
  const selectedCount = pendingCleanup ? pendingCleanup.selectedIndexes.size : 0;
  const totalCount = pendingCleanup ? pendingCleanup.removedRows.length : 0;
  const selectAll = document.getElementById("selectAllRows");
  if (selectAll) {
    selectAll.checked = totalCount > 0 && selectedCount === totalCount;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < totalCount;
  }

  document.getElementById("dialogRemovedCount").textContent = totalCount
    ? `${selectedCount} of ${totalCount} empty row${totalCount === 1 ? "" : "s"} selected for removal`
    : "No empty rows found";
  confirmCleanupButton.textContent = selectedCount
    ? `Remove ${selectedCount} row${selectedCount === 1 ? "" : "s"} and clean`
    : "Clean data only";
}