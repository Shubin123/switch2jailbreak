(function() {
  function resultIntegrity(output, expectedCount) {
    if (!output || !Array.isArray(output.results) || !output.summary) return ['Missing results or summary'];
    const errors = [];
    const keys = { pass: 'passed', fail: 'failed', skip: 'skipped', error: 'errors' };
    const counts = { passed: 0, failed: 0, skipped: 0, errors: 0 };
    const identifiers = new Set();
    for (const result of output.results) {
      if (!result || typeof result.test_id !== 'string' || !result.test_id ||
          typeof result.name !== 'string' || !result.name || typeof result.category !== 'string' ||
          !Object.prototype.hasOwnProperty.call(keys, result.status)) {
        errors.push('Invalid observation');
        continue;
      }
      if (identifiers.has(result.test_id)) errors.push('Duplicate test identifier: ' + result.test_id);
      identifiers.add(result.test_id);
      counts[keys[result.status]] += 1;
    }
    if (expectedCount !== undefined && output.results.length !== expectedCount) errors.push('Unexpected observation count');
    if (output.summary.total !== output.results.length) errors.push('Summary total does not match results');
    for (const key of Object.keys(counts)) {
      if (output.summary[key] !== counts[key]) errors.push('Summary ' + key + ' does not match results');
    }
    if (output.complete === false) errors.push('Run is incomplete');
    return errors;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = resultIntegrity;
  else if (typeof window !== 'undefined') window.resultIntegrity = resultIntegrity;
})();
