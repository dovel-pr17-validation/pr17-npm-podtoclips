const localStore = require('./episodeStore.cjs');
const neonStore = require('./neonEpisodeStore.cjs');
const { hasDatabaseUrl } = require('./neonDb.cjs');

function selectedStore() {
  return hasDatabaseUrl() ? neonStore : localStore;
}

module.exports = new Proxy({}, {
  get(_target, prop) {
    return selectedStore()[prop];
  },
});

