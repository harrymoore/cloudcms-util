var randomString = require('../index');
var assert = require('assert');

describe('Using', function() {
  it('Length', function() {
    var expectedResult = 16;
    var result = randomString(16);
    assert(result.length === expectedResult);
  });
});
