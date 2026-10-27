const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

for (const [error, expected] of [
  ['Object.assign(new Error("too much recursion"), { name: "InternalError" })', 'pass'],
  ['new TypeError("unrelated failure")', 'fail'],
  ['({ name: "InternalError" })', 'fail'],
]) {
  test(`recursion classification: ${error}`, () => {
    const source = fs.readFileSync(path.join(__dirname, 'runtime-errors/error-handling.js'), 'utf8');
    const instrumented = source.replace('(function recurse() { recurse(); })();', `throw ${error};`);
    assert.notEqual(instrumented, source);
    const context = vm.createContext({ navigator: { userAgent: 'synthetic-error-check', platform: 'test-host' } });
    context.window = context;
    vm.runInContext(instrumented, context, { timeout: 10000 });
    assert.equal(context.__errorResults.results.find(result => result.test_id === 'rt-err-001').status, expected);
  });
}
