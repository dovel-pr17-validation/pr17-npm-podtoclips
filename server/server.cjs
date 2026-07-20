const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { createApp } = require('./src/app.cjs');

const PORT = Number(process.env.PORT || 3005);
const app = createApp();

app.listen(PORT, () => {
  console.log(`Podcast Repurposing Engine API running on http://localhost:${PORT}`);
});

