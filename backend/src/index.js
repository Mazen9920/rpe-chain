require('dotenv').config();
const app = require('./app');
const scheduler = require('./scheduler');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`RPE Supply API running on port ${PORT}`);
  scheduler.start();
});
