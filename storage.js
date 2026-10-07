module.exports = function createStorage(fs, core) {
  let queue = Promise.resolve();
  return {
    async load() {
      const folder = await fs.getDataFolder();
      let file;
      try { file = await folder.getEntry('reflex.json'); } catch (_) { return { state: core.defaults(), warning: '' }; }
      try {
        return { state: core.cleanState(JSON.parse(await file.read())), warning: '' };
      } catch (_) {
        return { state: core.defaults(), warning: 'Saved settings could not be read. Defaults are loaded; the original file is kept until you save a change.' };
      }
    },
    save(state) {
      const json = JSON.stringify(core.cleanState(state), null, 2);
      queue = queue.catch(() => {}).then(async () => {
        const folder = await fs.getDataFolder();
        const file = await folder.createFile('reflex.json', { overwrite: true });
        await file.write(json);
      });
      return queue;
    }
  };
};
