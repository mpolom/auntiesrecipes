Weekly scrape (GitHub Actions and local cron)

This repository includes a GitHub Actions workflow that runs a weekly download + scrape.

- Workflow: [.github/workflows/scrape-weekly.yml](.github/workflows/scrape-weekly.yml)
- Runner script used by the workflow and for local cron: `scripts/run_weekly_scrape.sh`

To run locally via cron, edit your crontab (`crontab -e`) and add a line like:

```cron
0 3 * * 1 cd /path/to/auntiesrecipes && bash scripts/run_weekly_scrape.sh >> /var/log/auntiesrecipes-scrape.log 2>&1
```

Notes:
- The script runs the downloader first (prefers `downloader/run_downloader.mjs`), then runs the scraper with `RECIPE_DIR=downloader/html`.
- The full run may take a long time depending on the number of pages; consider running in a machine with sufficient memory and disk.
- To test quickly, you can copy a single HTML file into a temporary folder and run:

```bash
mkdir -p /tmp/aunties-test
cp downloader/html/www_bbc_co_uk_food_recipes_2-ingredient_bagels_98100.html /tmp/aunties-test/
RECIPE_DIR=/tmp/aunties-test node scraper/scrape.js
```
