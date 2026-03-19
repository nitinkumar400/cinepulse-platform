const path = require('path');
const { runtime, getFrontendOrigin, getCorsOrigins } = require('./env');

const isProduction = runtime === 'production';

module.exports = {
  isProduction,
  uploadPath: isProduction ? '/tmp/uploads' : path.join(__dirname, '../uploads'),
  corsOrigins: getCorsOrigins(),
  frontendOrigin: getFrontendOrigin(),
};
