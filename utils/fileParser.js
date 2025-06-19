const fs = require('fs');
const csv = require('csv-parse');
const xlsx = require('xlsx');
const path = require('path');

/**
 * Parses a contacts file (CSV or Excel) and returns an array of { phoneNumber, name }
 * @param {string} filePath - Path to the uploaded file
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<Array<{ phoneNumber: string, name: string }>>}
 */
async function parseContactsFile(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv' || mimeType === 'text/csv') {
    return parseCSV(filePath);
  } else if (ext === '.xls' || ext === '.xlsx' || mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
    return parseExcel(filePath);
  } else {
    throw new Error('Unsupported file type. Please upload a CSV or Excel file.');
  }
}

function parseCSV(filePath) {
  // Helper to try parsing with a given delimiter
  function tryParse(delimiter) {
    return new Promise((resolve, reject) => {
      const contacts = [];
      let headerChecked = false;
      fs.createReadStream(filePath)
        .pipe(csv.parse({ columns: true, trim: true, skip_empty_lines: true, delimiter }))
        .on('data', (row) => {
          if (!headerChecked) {
            if (!('phoneNumber' in row) && !('phone' in row) && !('Phone Number' in row) && !('Phone' in row)) {
              reject(new Error('CSV header must include a "phoneNumber" or "phone" column.'));
            }
            headerChecked = true;
          }
          const phoneNumber = row.phoneNumber || row['Phone Number'] || row.phone || row['Phone'];
          const name = row.name || row['Name'] || 'Unknown';
          if (phoneNumber) {
            contacts.push({ phoneNumber, name });
          }
        })
        .on('end', () => {
          if (contacts.length === 0) {
            return reject(new Error('CSV file is empty or missing required columns (phoneNumber, name)'));
          }
          resolve(contacts);
        })
        .on('error', (err) => reject(err));
    });
  }

  // Try comma, then semicolon
  return tryParse(',').catch(() => tryParse(';')).catch(err => {
    throw new Error('CSV parsing failed: ' + err.message + ' (make sure your file is a valid CSV with columns: phoneNumber, name)');
  });
}


function parseExcel(filePath) {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
    const contacts = rows.map(row => ({
      phoneNumber: row.phoneNumber || row['Phone Number'] || row['phone'] || row['Phone'],
      name: row.name || row['Name'] || 'Unknown',
    })).filter(c => c.phoneNumber);
    if (contacts.length === 0) {
      throw new Error('Excel file is empty or missing required columns (phoneNumber, name)');
    }
    return contacts;
  } catch (err) {
    throw new Error('Excel parsing failed: ' + err.message);
  }
}

module.exports = { parseContactsFile };
