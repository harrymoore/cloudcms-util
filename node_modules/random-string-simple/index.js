module.exports = function(length, symbols) {
  length = length || 7;
  symbols =
    symbols || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  var array = Array.from({ length: length }, function() {
    return symbols.charAt(Math.floor(Math.random() * symbols.length));
  });

  return array.join('');
};
