const fs = require('node:fs');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const resultIntegrity = require('../tests/result-integrity.js');
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(require('../results/schema.json'));

function validateResult(output, expectedCount) {
  const schemaErrors = validate(output) ? [] : validate.errors.map(error => `${error.instancePath}: ${error.message}`);
  return schemaErrors.concat(resultIntegrity(output, expectedCount));
}

module.exports = validateResult;

if (require.main === module) {
  const filenames = process.argv.slice(2);
  if (!filenames.length) {
    console.error('Usage: node scripts/validate-results.cjs RESULTS.json [...]');
    process.exitCode = 1;
  }
  for (const filename of filenames) {
    try {
      const errors = validateResult(JSON.parse(fs.readFileSync(filename, 'utf8')));
      if (errors.length) throw new Error(errors.join('; '));
      console.log(`Valid evidence: ${filename}`);
    } catch (error) {
      console.error(`${filename}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
