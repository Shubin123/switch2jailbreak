const fs = require('node:fs');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(require('../site/browser-entry.schema.json'));

function validateEntry(report) {
  return validate(report) ? [] : validate.errors.map(error => `${error.instancePath}: ${error.message}`);
}

module.exports = validateEntry;

if (require.main === module) {
  const filenames = process.argv.slice(2);
  if (!filenames.length) {
    console.error('Usage: node scripts/validate-browser-entry.cjs <entry-report.json> [...]');
    process.exitCode = 1;
  }
  for (const filename of filenames) {
    try {
      const errors = validateEntry(JSON.parse(fs.readFileSync(filename, 'utf8')));
      if (errors.length) throw new Error(errors.join('; '));
      console.log(`Valid navigation evidence (not attested): ${filename}`);
    } catch (error) {
      console.error(`${filename}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
