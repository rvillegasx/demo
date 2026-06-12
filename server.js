const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 3000;

function normalizeStatus(s) {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeType(s) {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function preprocessCSV(content) {
  // Fix fee values like "$2,495.00" → strip $ and inner comma
  content = content.replace(/"(\$[\d,]+\.?\d*)"/g, (_, m) => m.replace(/[$,]/g, ''));
  // Fix names like "Big O" Roofing → Big O Roofing
  content = content.replace(/"([^",\n]+)"\s+([^,\n]+)/g, '$1 $2');
  return content;
}

function loadData() {
  const csvPath = path.join(__dirname, 'data', 'data.csv');
  const raw_content = fs.readFileSync(csvPath, 'utf-8');
  const content = preprocessCSV(raw_content);
  const raw = parse(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });

  return raw.map((r, i) => {
    const fee = parseFloat(r.fee);
    const statusRaw = r.status || '';
    const statusNorm = normalizeStatus(statusRaw);
    const typeNorm = normalizeType(r.permit_type);

    const flags = [];
    if (!isNaN(fee) && fee < 0) flags.push('negative_fee');
    if (statusRaw !== statusNorm && statusRaw.trim() !== '') flags.push('case_issue');
    if (!r.status || !r.status.trim()) flags.push('missing_status');
    if (!r.permit_type || !r.permit_type.trim()) flags.push('missing_type');

    return {
      ...r,
      _row: i + 1,
      fee: isNaN(fee) ? null : fee,
      status_normalized: statusNorm,
      permit_type_normalized: typeNorm,
      flags,
    };
  });
}

const records = loadData();
console.log(`Loaded ${records.length} records`);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/data', (req, res) => {
  res.json({ records, total: records.length });
});

app.get('/api/summary', (req, res) => {
  const fees = records.map(r => r.fee).filter(f => f !== null);
  const avgFee = fees.length ? (fees.reduce((a, b) => a + b, 0) / fees.length).toFixed(2) : 0;

  const byStatus = {};
  records.forEach(r => {
    const k = r.status_normalized || '(blank)';
    byStatus[k] = (byStatus[k] || 0) + 1;
  });

  const byType = {};
  records.forEach(r => {
    const k = r.permit_type_normalized || '(blank)';
    byType[k] = (byType[k] || 0) + 1;
  });

  const byMunicipality = {};
  records.forEach(r => {
    const k = (r.municipality || '').trim() || '(blank)';
    byMunicipality[k] = (byMunicipality[k] || 0) + 1;
  });

  const flagged = records.filter(r => r.flags.length > 0);

  res.json({
    total: records.length,
    avgFee: parseFloat(avgFee),
    negativeFees: records.filter(r => r.flags.includes('negative_fee')).length,
    caseIssues: records.filter(r => r.flags.includes('case_issue')).length,
    flaggedTotal: flagged.length,
    byStatus,
    byType,
    byMunicipality,
  });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', records: records.length }));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
