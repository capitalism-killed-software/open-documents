// Fonts for documents that use a font without including it, mostly Chinese, Japanese and
// Korean text. EmbedPDF ships them as npm packages; by default its viewer fetches them from a
// public CDN. Ours fetches nothing from third parties: give `fonts-url` to serve them yourself,
// with one folder per package (fonts-jp, fonts-kr, fonts-sc, fonts-tc, fonts-arabic,
// fonts-hebrew, fonts-latin), each holding that package's fonts/ files.
import { FontCharset } from '@embedpdf/models';
import { fonts as jp } from '@embedpdf/fonts-jp';
import { fonts as kr } from '@embedpdf/fonts-kr';
import { fonts as sc } from '@embedpdf/fonts-sc';
import { fonts as tc } from '@embedpdf/fonts-tc';
import { fonts as arabic } from '@embedpdf/fonts-arabic';
import { fonts as hebrew } from '@embedpdf/fonts-hebrew';
import { fonts as latin } from '@embedpdf/fonts-latin';

/**
 * @param {string | null} base  where the font folders are served, or null for no fallback fonts
 */
export function fontConfig(base) {
  if (!base) return { fonts: {} };
  const root = base.replace(/\/+$/, '');
  /** @param {{ file: string, weight: number, italic?: boolean }[]} list @param {string} folder */
  const variants = (list, folder) => list.map((f) => ({ url: `${root}/${folder}/${f.file}`, weight: f.weight, italic: f.italic }));
  return {
    fonts: {
      [FontCharset.SHIFTJIS]: variants(jp, 'fonts-jp'),
      [FontCharset.HANGEUL]: variants(kr, 'fonts-kr'),
      [FontCharset.GB2312]: variants(sc, 'fonts-sc'),
      [FontCharset.CHINESEBIG5]: variants(tc, 'fonts-tc'),
      [FontCharset.ARABIC]: variants(arabic, 'fonts-arabic'),
      [FontCharset.HEBREW]: variants(hebrew, 'fonts-hebrew'),
      [FontCharset.CYRILLIC]: variants(latin, 'fonts-latin'),
      [FontCharset.GREEK]: variants(latin, 'fonts-latin'),
      [FontCharset.VIETNAMESE]: variants(latin, 'fonts-latin'),
    },
  };
}
