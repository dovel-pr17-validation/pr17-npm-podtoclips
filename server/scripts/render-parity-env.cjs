const { cloudRunEnvCsv } = require('../src/renderWorker/renderParityProfile.cjs');

process.stdout.write(cloudRunEnvCsv());
