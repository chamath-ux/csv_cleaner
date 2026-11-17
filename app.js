const fileInput = document.getElementById("fileInput");
const browseButton = document.getElementById("browseButton");
const message = document.getElementById("message");
const maxFileSize = 20 * 1024 * 1024;
const cleanButton = document.getElementById("cleanButton");
const cleanupDialog = document.getElementById("cleanupDialog");
const confirmCleanupButton = document.getElementById("confirmCleanupButton");
const cancelCleanupButton = document.getElementById("cancelCleanupButton");
const trimWhitespaceOption = document.getElementById("trimWhitespace");
const removeEmptyRowsOption = document.getElementById("removeEmptyRows");
const removeDuplicatesOption = document.getElementById("removeDuplicates");
const duplicateColumnOptions = document.getElementById("duplicateColumnOptions");
const duplicateColumnList = document.getElementById("duplicateColumnList");
const selectAllCompareColumns = document.getElementById("selectAllCompareColumns");
const {
  areAllCellsEmpty,
  detectIdentifierColumns,
  getRows,
  removeDuplicates,
  removeSelectedEmptyRows,
  trimWhitespace
} = window.CsvCleanup;
let csvRows = null;
let pendingCleanup = null;

browseButton.addEventListener("click", () => fileInput.click());

cleanButton.addEventListener("click", () => {
  if (!csvRows) return;

  const removeDuplicatesEnabled = removeDuplicatesOption.checked;
  const trimEnabled = trimWhitespaceOption.checked;
  const removeEmptyRowsEnabled = removeEmptyRowsOption.checked;
  if (!trimEnabled && !removeEmptyRowsEnabled && !removeDuplicatesEnabled) {
    message.classList.remove("success");
    message.textContent = "Select at least one cleanup option first.";
    return;
  }

  const rowsForCleanup = trimEnabled
    ? trimWhitespace(csvRows)
    : csvRows.map((row) => row.slice());
  const columnCount = csvRows.reduce((maximum, row) => Math.max(maximum, row.length), 0);

  pendingCleanup = {
    rowsForCleanup,
    candidates: [],
    columnCount,
    trimEnabled,
    removeEmptyRowsEnabled,
    removeDuplicatesEnabled,
    comparisonColumns: [],
    selectedSourceRows: new Set()
  };
  renderComparisonColumns(columnCount, rowsForCleanup[0] || [], removeDuplicatesEnabled);
  refreshCleanupCandidates(false);
  cleanupDialog.showModal();
});

confirmCleanupButton.addEventListener("click", () => {
  if (!pendingCleanup) return;
  const removedRows = pendingCleanup.candidates
    .filter(({ sourceRow }) => pendingCleanup.selectedSourceRows.has(sourceRow));
  const selectedEmptyRows = new Set(removedRows.filter(({ isEmpty }) => isEmpty).map(({ sourceRow }) => sourceRow));
  const selectedDuplicateRows = new Set(removedRows.filter(({ isDuplicate }) => isDuplicate).map(({ sourceRow }) => sourceRow));
  let records = pendingCleanup.rowsForCleanup.map((row, index) => ({ row, sourceRow: index + 1 }));
  if (pendingCleanup.removeEmptyRowsEnabled) {
    records = removeSelectedEmptyRows(records, selectedEmptyRows);
  }
  if (pendingCleanup.removeDuplicatesEnabled) {
    records = removeDuplicates(records, pendingCleanup.comparisonColumns, selectedDuplicateRows).rows;
  }
  const cleanedRows = records.map(({ row }) => row);
  const cleanup = {
    cleanedRows,
    removedRows,
    columnCount: pendingCleanup.columnCount,
    trimEnabled: pendingCleanup.trimEnabled,
    removeEmptyRowsEnabled: pendingCleanup.removeEmptyRowsEnabled,
    removeDuplicatesEnabled: pendingCleanup.removeDuplicatesEnabled
  };
  pendingCleanup = null;
  cleanupDialog.close();
  applyCleanup(cleanup);
});

document.getElementById("dialogRemovedTable").addEventListener("change", (event) => {
  if (!pendingCleanup) return;

  if (event.target.matches("#selectAllRows")) {
    pendingCleanup.selectedSourceRows = event.target.checked
      ? new Set(pendingCleanup.candidates.map(({ sourceRow }) => sourceRow))
      : new Set();
    document.querySelectorAll(".remove-row-checkbox").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
  } else if (event.target.matches(".remove-row-checkbox")) {
    const sourceRow = Number(event.target.dataset.sourceRow);
    if (event.target.checked) {
      pendingCleanup.selectedSourceRows.add(sourceRow);
    } else {
      pendingCleanup.selectedSourceRows.delete(sourceRow);
    }
  }
  updateDialogSelection();
});

duplicateColumnOptions.addEventListener("change", (event) => {
  if (!pendingCleanup) return;

  if (event.target === selectAllCompareColumns) {
    duplicateColumnList.querySelectorAll(".duplicate-column-checkbox").forEach((checkbox) => {
      checkbox.checked = selectAllCompareColumns.checked;
    });
  }
  pendingCleanup.comparisonColumns = getComparisonColumns();
  selectAllCompareColumns.checked = pendingCleanup.columnCount > 0 &&
    pendingCleanup.comparisonColumns.length === pendingCleanup.columnCount;
  selectAllCompareColumns.indeterminate =
    pendingCleanup.comparisonColumns.length > 0 &&
    pendingCleanup.comparisonColumns.length < pendingCleanup.columnCount;
  refreshCleanupCandidates(true);
});

cancelCleanupButton.addEventListener("click", () => cleanupDialog.close());
cleanupDialog.addEventListener("close", () => {
  pendingCleanup = null;
  cleanButton.focus();
});

function applyCleanup({
  cleanedRows,
  removedRows,
  columnCount,
  trimEnabled,
  removeEmptyRowsEnabled,
  removeDuplicatesEnabled
}) {
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
  const completedActions = [];
  if (trimEnabled) completedActions.push("whitespace trimmed");
  if (removeEmptyRowsEnabled) {
    completedActions.push(`${removedRows.filter(({ isEmpty }) => isEmpty).length} empty row(s) removed`);
  }
  if (removeDuplicatesEnabled) {
    completedActions.push(
      `${removedRows.filter(({ isDuplicate }) => isDuplicate).length} duplicate row(s) removed`
    );
  }
  message.textContent = `Cleanup complete: ${completedActions.join(" and ")}. Results are shown in the preview.`;
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

function renderComparisonColumns(columnCount, headerRow, enabled) {
  duplicateColumnOptions.hidden = !enabled;
  duplicateColumnList.replaceChildren();
  if (!enabled) {
    pendingCleanup.comparisonColumns = [];
    return;
  }

  const identifierColumns = detectIdentifierColumns(headerRow);
  for (let column = 0; column < columnCount; column += 1) {
    const label = document.createElement("label");
    label.className = "duplicate-column-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "duplicate-column-checkbox";
    checkbox.dataset.columnIndex = String(column);
    checkbox.checked = !identifierColumns.has(column);
    const name = String(headerRow[column] || "").trim();
    const text = document.createElement("span");
    text.textContent = name ? `Column ${column + 1}: ${name}` : `Column ${column + 1}`;
    label.append(checkbox, text);
    duplicateColumnList.appendChild(label);
  }
  pendingCleanup.comparisonColumns = getComparisonColumns();
  updateCompareAllCheckbox();
}

function getComparisonColumns() {
  return Array.from(duplicateColumnList.querySelectorAll(".duplicate-column-checkbox"))
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => Number(checkbox.dataset.columnIndex));
}

function updateCompareAllCheckbox() {
  const checkedCount = getComparisonColumns().length;
  selectAllCompareColumns.checked = pendingCleanup.columnCount > 0 &&
    checkedCount === pendingCleanup.columnCount;
  selectAllCompareColumns.indeterminate =
    checkedCount > 0 && checkedCount < pendingCleanup.columnCount;
}

function refreshCleanupCandidates(preserveSelection) {
  const previousSelection = pendingCleanup.selectedSourceRows;
  const indexedRows = pendingCleanup.rowsForCleanup.map((row, index) => ({ row, sourceRow: index + 1 }));
  const duplicateResult = pendingCleanup.removeDuplicatesEnabled
    ? removeDuplicates(indexedRows, pendingCleanup.comparisonColumns)
    : { duplicates: [], groups: [] };
  const candidates = buildCleanupCandidates(
    indexedRows,
    duplicateResult.duplicates,
    pendingCleanup.removeEmptyRowsEnabled
  );

  pendingCleanup.candidates = candidates;
  pendingCleanup.duplicateGroups = duplicateResult.groups;
  pendingCleanup.selectedSourceRows = new Set(candidates
    .filter(({ sourceRow }) => !preserveSelection || previousSelection.has(sourceRow))
    .map(({ sourceRow }) => sourceRow));
  renderDialogRemovedRows(candidates, pendingCleanup.columnCount, pendingCleanup.selectedSourceRows);
  renderDuplicateGroups(duplicateResult.groups, pendingCleanup.columnCount);
  updateCleanupEmptyMessage(candidates);
  document.getElementById("dialogPreviewLimit").textContent =
    candidates.length > 100 ? "Showing first 100 rows" : "";
  updateDialogSelection();
}

function buildCleanupCandidates(indexedRows, duplicateRecords, removeEmptyRowsEnabled) {
  const duplicateSourceRows = new Set(duplicateRecords.map(({ sourceRow }) => sourceRow));
  return indexedRows.flatMap((record) => {
    const isEmpty = removeEmptyRowsEnabled && areAllCellsEmpty(record.row);
    const isDuplicate = duplicateSourceRows.has(record.sourceRow);
    if (!isEmpty && !isDuplicate) return [];

    let reason = "Potential duplicate";
    if (isEmpty && isDuplicate) {
      reason = "Empty and potential duplicate";
    } else if (isEmpty) {
      reason = "Empty row";
    }
    return [{ ...record, isEmpty, isDuplicate, reason }];
  });
}

function updateCleanupEmptyMessage(candidates) {
  if (candidates.length > 0) return;

  const enabledActions = [];
  if (pendingCleanup.trimEnabled) enabledActions.push("whitespace will be trimmed");
  if (pendingCleanup.removeEmptyRowsEnabled) enabledActions.push("no empty rows were found");
  if (pendingCleanup.removeDuplicatesEnabled) {
    enabledActions.push(pendingCleanup.comparisonColumns.length
      ? "no potential duplicate rows were found"
      : "select at least one column to compare");
  }
  document.getElementById("dialogEmptyMessage").textContent =
    `No rows will be removed; ${enabledActions.join(" and ")}.`;
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
  const reasonHeading = document.createElement("th");
  reasonHeading.textContent = "REASON";
  header.appendChild(reasonHeading);
  for (let column = 0; column < columnCount; column += 1) {
    const heading = document.createElement("th");
    heading.textContent = `COLUMN ${column + 1}`;
    header.appendChild(heading);
  }
  tableHead.appendChild(header);

  rows.slice(0, 100).forEach(({ row, sourceRow, reason }) => {
    const tableRow = document.createElement("tr");
    const sourceCell = document.createElement("td");
    sourceCell.textContent = String(sourceRow);
    tableRow.appendChild(sourceCell);
    const reasonCell = document.createElement("td");
    reasonCell.textContent = reason;
    tableRow.appendChild(reasonCell);
    for (let column = 0; column < columnCount; column += 1) {
      const cell = document.createElement("td");
      cell.textContent = row[column] || "";
      tableRow.appendChild(cell);
    }
    tableBody.appendChild(tableRow);
  });
}

function renderDialogRemovedRows(rows, columnCount, selectedSourceRows) {
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
  selectAll.setAttribute("aria-label", "Select all rows marked for removal");
  selectAll.checked = rows.every(({ sourceRow }) => selectedSourceRows.has(sourceRow));
  selectAllHeading.appendChild(selectAll);
  header.appendChild(selectAllHeading);
  const labels = ["CSV ROW", "REASON"];
  for (let column = 0; column < columnCount; column += 1) {
    labels.push(`COLUMN ${column + 1}`);
  }
  labels.forEach((label) => {
    const heading = document.createElement("th");
    heading.textContent = label;
    header.appendChild(heading);
  });
  tableHead.appendChild(header);

  rows.slice(0, 100).forEach(({ row, sourceRow, reason }) => {
    const tableRow = document.createElement("tr");
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "row-select-checkbox remove-row-checkbox";
    checkbox.dataset.sourceRow = String(sourceRow);
    checkbox.setAttribute("aria-label", `Select CSV row ${sourceRow}, ${reason}, for removal`);
    checkbox.checked = selectedSourceRows.has(sourceRow);
    selectCell.appendChild(checkbox);
    tableRow.appendChild(selectCell);

    const sourceCell = document.createElement("td");
    sourceCell.textContent = String(sourceRow);
    tableRow.appendChild(sourceCell);
    const reasonCell = document.createElement("td");
    reasonCell.textContent = reason;
    tableRow.appendChild(reasonCell);
    for (let column = 0; column < columnCount; column += 1) {
      const cell = document.createElement("td");
      cell.textContent = row[column] || "(empty)";
      tableRow.appendChild(cell);
    }
    tableBody.appendChild(tableRow);
  });
}

function updateDialogSelection() {
  const selectedCount = pendingCleanup
    ? pendingCleanup.candidates.filter(({ sourceRow }) => pendingCleanup.selectedSourceRows.has(sourceRow)).length
    : 0;
  const totalCount = pendingCleanup ? pendingCleanup.candidates.length : 0;
  const selectAll = document.getElementById("selectAllRows");
  if (selectAll) {
    selectAll.checked = totalCount > 0 && selectedCount === totalCount;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < totalCount;
  }

  document.getElementById("dialogRemovedCount").textContent = totalCount
    ? `${selectedCount} of ${totalCount} row${totalCount === 1 ? "" : "s"} selected for removal`
    : "No rows found for the selected cleanup options";
  confirmCleanupButton.textContent = selectedCount
    ? `Remove ${selectedCount} row${selectedCount === 1 ? "" : "s"} and clean`
    : (pendingCleanup && pendingCleanup.trimEnabled ? "Trim whitespace" : "Keep rows");
}

function renderDuplicateGroups(groups, columnCount) {
  const section = document.getElementById("duplicateGroupsPreview");
  const tableHead = document.getElementById("duplicateGroupsTableHead");
  const tableBody = document.getElementById("duplicateGroupsTableBody");
  tableHead.replaceChildren();
  tableBody.replaceChildren();
  section.hidden = groups.length === 0;
  if (groups.length === 0) return;

  const header = document.createElement("tr");
  ["MATCH GROUP", "CSV ROW", "STATUS", ...Array.from(
    { length: columnCount },
    (_, index) => `COLUMN ${index + 1}`
  )].forEach((label) => {
    const heading = document.createElement("th");
    heading.textContent = label;
    header.appendChild(heading);
  });
  tableHead.appendChild(header);

  const matches = groups.flatMap((group) =>
    group.rows.map((record, index) => ({
      ...record,
      groupNumber: group.groupNumber,
      status: index === 0 ? "Keep" : "Potential duplicate"
    }))
  );
  matches.slice(0, 100).forEach(({ row, sourceRow, groupNumber, status }) => {
    const tableRow = document.createElement("tr");
    [groupNumber, sourceRow, status, ...Array.from(
      { length: columnCount },
      (_, column) => row[column] || "(empty)"
    )].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      tableRow.appendChild(cell);
    });
    tableBody.appendChild(tableRow);
  });
}