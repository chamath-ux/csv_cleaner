window.CsvCleanup = (() => {
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

  function removeSelectedEmptyRows(rows, selectedSourceRows) {
    return rows.filter(({ row, sourceRow }) => {
      return !selectedSourceRows.has(sourceRow) || !areAllCellsEmpty(row);
    });
  }

  function areAllCellsEmpty(row) {
    return checkEmptyCells(row).every(Boolean);
  }

  function checkEmptyCells(row) {
    return row.map((cell) => String(cell ?? "").trim() === "");
  }

  function detectIdentifierColumns(headerRow) {
    const identifierName = /(^|[\s_-])(id|uuid|guid|identifier|key)(?=$|[\s_-])/i;
    return new Set(headerRow.reduce((columns, value, index) => {
      if (identifierName.test(String(value).trim())) columns.push(index);
      return columns;
    }, []));
  }

  function removeDuplicates(records, comparisonColumns, selectedSourceRows = new Set()) {
    if (comparisonColumns.length === 0) {
      return { rows: records.slice(), duplicates: [], groups: [] };
    }

    const groupedRecords = new Map();
    records.forEach((record) => {
      const key = JSON.stringify(comparisonColumns.map((column) =>
        normalizeDuplicateValue(record.row[column])
      ));
      if (!groupedRecords.has(key)) groupedRecords.set(key, []);
      groupedRecords.get(key).push(record);
    });

    const groups = Array.from(groupedRecords.values())
      .filter((rows) => rows.length > 1)
      .map((rows, index) => ({ groupNumber: index + 1, rows }));
    const duplicates = groups.flatMap(({ rows }) =>
      rows.slice(1).map((record) => ({
        ...record,
        isEmpty: areAllCellsEmpty(record.row),
        isDuplicate: true,
        reason: "Potential duplicate"
      }))
    );
    const duplicateSourceRows = new Set(duplicates.map(({ sourceRow }) => sourceRow));
    const remainingRows = records.filter(({ sourceRow }) =>
      !duplicateSourceRows.has(sourceRow) || !selectedSourceRows.has(sourceRow)
    );

    return { rows: remainingRows, duplicates, groups };
  }

  function normalizeDuplicateValue(value) {
    return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  return {
    areAllCellsEmpty,
    detectIdentifierColumns,
    getRows,
    removeDuplicates,
    removeSelectedEmptyRows,
    trimWhitespace
  };
})();
