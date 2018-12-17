const cheerio = require('cheerio');
const csstree = require('css-tree');
const { URL } = require('url');
const Generator = require('./dom-link-renamer');

let generator;

const CSS_REPLACE_RE = /url\(['"]?(?!["']?data)(.+?)['"]?\)/g;

module.exports = {
  html(domBuffer, resourcesMap, baseUrl) {
    const gotString = typeof domBuffer === 'string';
    if (gotString) {
      domBuffer = Buffer.from(domBuffer);
    }
    if (generator) {
      generator.reset(domBuffer, resourcesMap, baseUrl);
    } else {
      generator = new Generator(domBuffer, resourcesMap, baseUrl);
      generator.cssProcessor = module.exports.css;
    }
    generator.parse();
    if (gotString) {
      return generator.result().toString();
    }
    return generator.result().slice();
  },
  svg(svgString, resourcesMap, baseUrl) {
    const $ = cheerio.load(svgString, { xmlMode: true });
    $('[href],[xlink\\:href]').each((i, el) => {
      el = $(el);
      const link = new URL(el.attr('href') || el.attr('xlink:href'), baseUrl).toString();
      const mapped = resourcesMap.get(link) || link;
      el.removeAttr('xlink:href');
      el.attr('href', mapped);
    });
    return $.html();
  },
  css(cssString, resourcesMap, baseUrl) {
    return cssString.toString().replace(CSS_REPLACE_RE, (whole, match) => {
      if (match.charAt(0) === '/' && match.charAt(1) === '/') { // protocol agnostic URL
        match = `http:${match}`;
      }
      const link = new URL(match, baseUrl).toString();
      const mapped = resourcesMap.get(link) || link;
      /* eslint-disable prefer-template */ // hot point
      return "url('" + mapped + "')";
    });
  },
  cssWithAst(cssString, resourcesMap, baseUrl) {
    // currently 2x times slower than the RE
    const ast = csstree.parse(cssString, { parseRulePrelude: false });
    csstree.walk(ast, function walker(node) {
      if (this.declaration === null || node.type !== 'Url') {
        return;
      }
      const { value } = node;
      if (value.type === 'Raw') {
        const link = new URL(value.value, baseUrl).toString();
        const mapped = resourcesMap.get(link) || link;
        value.value = `'${mapped}'`;
      } else {
        const link = new URL(value.value.substr(1, value.value.length - 2), baseUrl).toString();
        const mapped = resourcesMap.get(link) || link;
        value.value = `'${mapped}'`;
      }
    });
    return csstree.generate(ast);
  },
  htmlWithCheerio(domBuffer, resourcesMap, baseUrl) {
    // slower and currently unused with Cheerio which is way more allocation happy
    const $ = cheerio.load(domBuffer.toString(), {
      _useHtmlParser2: true, // cheerio 1 uses parse5 by default which is half the speed
      lowerCaseTags: false,
    });

    const pageBase = $('base[href]').attr('href');

    if (pageBase) {
      baseUrl = new URL(pageBase, baseUrl);
    }

    // img, picture, audio, video, script, source, iframe

    $('[src]').each((i, el) => {
      el = $(el);
      const link = new URL(el.attr('src'), baseUrl).toString();
      const mapped = resourcesMap.get(link) || link;
      el.attr('src', mapped);
    });

    $('[srcset]').each((i, el) => {
      el = $(el);
      const sources = el.attr('srcset').split(' ');
      el.attr('srcset', sources.map(src => new URL(src, baseUrl).toString()).map(m => resourcesMap.get(m) || m));
    });

    // css imports and link rel prefetch/prerender

    $('link[href]').each((i, el) => {
      el = $(el);
      const link = new URL(el.attr('href'), baseUrl).toString();
      const mapped = resourcesMap.get(link) || link;
      el.attr('href', mapped);
    });

    $('svg').find('[href],[xlink\\:href]').each((i, el) => {
      el = $(el);
      const link = new URL(el.attr('href') || el.attr('xlink:href'), baseUrl).toString();
      const mapped = resourcesMap.get(link) || link;
      el.removeAttr('xlink:href');
      el.attr('href', mapped);
    });

    // old and deprecated stuff, skipped

    // $('meta[http-equiv=refresh]').each((i, el) => {
    //   el = $(el);
    //   const re = /(\d)+; ?URL='?([^']*)'?/gi;
    //   const [, seconds, url] = re.exec(el.attr('content'));
    //   const link = new URL(url, baseUrl).toString();
    //   const mapped = resourcesMap.get(link) || link;
    //   el.attr('content', `${seconds}; url=${mapped}`);
    // });

    // $('object[data]').each((i, el) => {
    //   el = $(el);
    //   const link = new URL(el.attr('data'), baseUrl).toString();
    //   const mapped = resourcesMap.get(link) || link;
    //   el.attr('data', mapped);
    // });

    $('applet[code]').each((i, el) => {
      el = $(el);
      const link = new URL(el.attr('code'), baseUrl).toString();
      const mapped = resourcesMap.get(link) || link;
      el.attr('code', mapped);
    });

    return $.html();
  },
};
