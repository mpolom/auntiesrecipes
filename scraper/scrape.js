/*jslint -W110, node:true*/
/*

Process BBC Food Recipes into a sparse JSON format
A fairly hacky scraper.

1) Download all the recipes: wget --quiet http://www.bbc.co.uk/food/sitemap.xml --output-document - | egrep -o "https?://www.bbc.co.uk/food/recipes/[^&lt;]+" | wget -i -
2) Edit recipeDir to point to the folder that contains the files
3) node --max-old-space-size=8192 scrape.js 
4) Read titles.json

Let me know what you build, I'd love to hear about it; @user24

This script is very loosely based on https://github.com/forbesg/bbc-good-food-recipe-scraper

*/
"use strict";

import * as cheerio from 'cheerio';
import { readdir, readFile as fsReadFile, writeFile, mkdir, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { constants as fsConstants } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const recipeDir = process.env.RECIPE_DIR || path.join(__dirname, '..', 'downloader', 'html');

async function readFiles(dirname, onFileContent, onError) {
    try {
        const filenames = await readdir(dirname);
        const limit = 200;
        let index = 0;
        let processed = 0;
        const maxFiles = parseInt(process.env.MAX_FILES || '0') || 0;

        async function worker() {
            while (true) {
                const i = index++;
                if (i >= filenames.length) break;
                if (maxFiles > 0 && processed >= maxFiles) break;
                const name = filenames[i];
                try {
                    const content = await fsReadFile(`${dirname}/${name}`, 'utf8');
                    await onFileContent(`${dirname}/${name}`, content);
                    processed++;
                } catch (err) {
                    onError(err);
                }
            }
        }

        const workers = Array.from({ length: Math.min(limit, filenames.length) }, () => worker());
        await Promise.all(workers);
    } catch (err) {
        onError(err);
    }
}

// Converts PT30M to '30' and PT2H to '120'
// Cooking Times are returned in ISO 8601 format (PT2H)
function parseTime(time) {
    if (!time) return null;
    const s = time.substring(2);
    if (s.indexOf('M') > -1) return parseInt(s);
    if (s.indexOf('H') > -1) return parseInt(s) * 60;
    return null;
}

const titleDB = {};
const shorterLookups = [];
const db = {};

async function parseRecipe(name, html) {
    const recipe = { ingredients: [], method: [] };
    recipe.url = name.substring(recipeDir.length + 1);
    recipe.url = recipe.url.substring(0, recipe.url.length - 5);
    const $ = cheerio.load(html);

    // Try to extract structured JSON-LD first (many pages include a Recipe object)
    function extractJsonLdRecipe() {
        const scripts = $('script[type="application/ld+json"]').toArray();
        for (const s of scripts) {
            const text = $(s).contents().text().trim();
            if (!text) continue;
            try {
                const data = JSON.parse(text);
                const found = [];
                const walk = (obj) => {
                    if (!obj) return;
                    if (Array.isArray(obj)) return obj.forEach(walk);
                    if (obj['@graph']) walk(obj['@graph']);
                    if (obj['@type'] === 'Recipe' || (Array.isArray(obj['@type']) && obj['@type'].includes('Recipe'))) found.push(obj);
                };
                walk(data);
                if (found.length) return found[0];
            } catch (e) {
                // ignore JSON parse errors and continue
            }
        }
        return null;
    }

    const jsonLd = extractJsonLdRecipe();

    // Title
    recipe.title = (jsonLd && (jsonLd.name || jsonLd.headline)) || $('h1.content-title__text').text().trim();
    if (!recipe.title) return null;

    // Ingredients
    if (jsonLd && Array.isArray(jsonLd.recipeIngredient) && jsonLd.recipeIngredient.length) {
        recipe.ingredients = jsonLd.recipeIngredient.map(i => (typeof i === 'string' ? i.trim() : ''));
    } else {
        $('.recipe-ingredients__list-item').each(function () {
            const text = $(this).text();
            const lineBreak = text.indexOf('\n');
            if (lineBreak > 0) recipe.ingredients.push(text.substring(0, lineBreak));
            else recipe.ingredients.push(text);
        });
    }

    // Method / instructions
    if (jsonLd && Array.isArray(jsonLd.recipeInstructions) && jsonLd.recipeInstructions.length) {
        // recipeInstructions can be strings or objects with 'text' or array of HowToStep
        jsonLd.recipeInstructions.forEach(item => {
            if (!item) return;
            if (typeof item === 'string') recipe.method.push(item.trim());
            else if (item.text) recipe.method.push(item.text.trim());
            else if (Array.isArray(item)) item.forEach(sub => { if (sub && sub.text) recipe.method.push(sub.text.trim()); });
            else if (item['@type'] === 'HowToStep' && item.text) recipe.method.push(item.text.trim());
        });
    } else {
        $('.recipe-method__list-item-text').each(function () {
            recipe.method.push($(this).text());
        });
    }

    // Times
    recipe.time = { preparation: null, preparationMins: 0, cooking: null, cookingMins: 0 };
    if (jsonLd) {
        recipe.time.preparation = jsonLd.prepTime || jsonLd.preparation || null;
        recipe.time.preparationMins = parseTime(jsonLd.prepTime || jsonLd.preparation) || 0;
        recipe.time.cooking = jsonLd.cookTime || null;
        recipe.time.cookingMins = parseTime(jsonLd.cookTime) || 0;
        if (!recipe.time.totalMins) recipe.time.totalMins = parseTime(jsonLd.totalTime) || (recipe.time.preparationMins + recipe.time.cookingMins);
    }
    if (!recipe.time.totalMins) {
        recipe.time.preparation = recipe.time.preparation || $('.recipe-metadata__prep-time').text();
        recipe.time.preparationMins = recipe.time.preparationMins || parseTime($('.recipe-metadata__prep-time').attr('content')) || 0;
        recipe.time.cooking = recipe.time.cooking || $('.recipe-metadata__cook-time').text();
        recipe.time.cookingMins = recipe.time.cookingMins || parseTime($('.recipe-metadata__cook-time').attr('content')) || 0;
        recipe.time.totalMins = (recipe.time.preparationMins || 0) + (recipe.time.cookingMins || 0);
    }

    // Serves, image, dietary flags
    recipe.serves = (jsonLd && (jsonLd.recipeYield || jsonLd.yield)) || $('.recipe-metadata__serving').text();
    if (jsonLd && jsonLd.image) {
        if (typeof jsonLd.image === 'string') recipe.image = jsonLd.image;
        else if (Array.isArray(jsonLd.image) && jsonLd.image.length) recipe.image = jsonLd.image[0];
        else if (jsonLd.image.url) recipe.image = jsonLd.image.url;
    } else {
        recipe.image = $('meta[property="og:image"]').attr('content');
    }
    if (recipe.image && recipe.image.indexOf('bbc_placeholder.png') > -1) delete recipe.image;
    recipe.isVegetarian = $('.recipe-metadata__dietary-vegetarian').length ? true : false;
    recipe.recommendations = parseInt($('.recipe-metadata__recommendations').text()) || 0;

    const recipeData = {};
    recipeData.t = recipe.title;
    recipeData.l = recipe.ingredients.length;
    if (recipe.image) recipeData.i = 1;
    if (recipe.isVegetarian) recipeData.v = 1;
    if (recipe.time.preparationMins) recipeData.p = recipe.time.preparationMins;
    if (recipe.time.cookingMins) recipeData.c = recipe.time.cookingMins;
    if (recipe.recommendations) recipeData.r = recipe.recommendations;

    titleDB[recipe.url] = recipeData;
    return recipe;
}

// Run
(async () => {
    try {
        await readFiles(recipeDir, async (name, html) => {
            try {
                const recipe = await parseRecipe(name, html);
                // download lead image if present
                if (process.env.DOWNLOAD_IMAGES === '1' && recipe && recipe.image) {
                    try {
                        const imagesDir = path.join(__dirname, '..', 'downloader', 'html', 'images');
                        await mkdir(imagesDir, { recursive: true });
                        const imgUrl = recipe.image;
                        let ext = '.jpg';
                        try {
                            const p = new URL(imgUrl).pathname;
                            const e = path.extname(p);
                            if (e) ext = e;
                        } catch (e) {
                            // ignore
                        }
                        const imgOut = path.join(imagesDir, recipe.url + ext);
                        // only fetch if not exists
                        try {
                            await access(imgOut, fsConstants.F_OK);
                        } catch (e) {
                            const res = await fetch(imgUrl, { headers: { 'User-Agent': 'auntiesrecipes image-downloader' } });
                            if (res.ok) {
                                const buf = Buffer.from(await res.arrayBuffer());
                                await writeFile(imgOut, buf);
                            }
                        }
                        // store relative path for search UI
                        titleDB[recipe.url].img = path.join('downloader', 'html', 'images', recipe.url + ext).replace(/\\/g, '/');
                    } catch (e) {
                        console.error('image download error for', recipe.url, e.message || e);
                    }
                }
            } catch (e) {
                console.error('parse error for', name, e.message || e);
            }
        }, (err) => console.error(err));

        await writeFile('titles.json', JSON.stringify(titleDB));
        console.log('titles.json written, recipes processed:', Object.keys(titleDB).length);
    } catch (e) {
        console.error(e);
    }
})();
