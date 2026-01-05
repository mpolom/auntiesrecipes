import('./downloader/index.js')
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
