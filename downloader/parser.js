"use strict"

import * as htmlparser from 'htmlparser2';

export default class Parser {
    parse(body, done) {
        const items = [];

        let openTag;
        let inItem = false;

        const parser = new htmlparser.Parser({
            onopentag(name, attribs) {
                if (name === 'loc') {
                    inItem = true;
                }
                openTag = name;
            },
            ontext(text) {
                const t = text && text.toString().trim();
                if (inItem && t && t.length > 0) {
                    items.push(t);
                }
            },
            onclosetag(name) {
                if (name === 'loc') {
                    inItem = false;
                }
                openTag = null;
            },
            onend() {
                done(null, items);
            }
        }, { decodeEntities: true });

        parser.write(body);
        parser.end();
    }
}
