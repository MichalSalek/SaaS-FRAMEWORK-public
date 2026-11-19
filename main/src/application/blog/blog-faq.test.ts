import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import {
  buildBlogFaqJsonLd,
  extractBlogFaq,
  markdownToPlainText,
} from './blog-faq';

const POST = `Intro paragraph.

## Ile to kosztuje

### Not a FAQ question

Body outside the FAQ.

## Najczęstsze pytania

### Czy kod QR wygasa?

Nie. To **stały** kod przypisany do Twojego profilu.

### Gdzie najlepiej powiesić kod?

Tam, gdzie klientka ma chwilę. Opisuję to w tekście [QR na lustrze](/blog/qr-w-salonie-stale-klientki/).
Druga linia tego samego akapitu.

Stały kod QR masz na koncie od pierwszej chwili. [Załóż darmowe konto](/for-stylists): plan Free jest dostępny od razu.
`;

describe('extractBlogFaq', () => {
  it('reads the questions and answers of the FAQ section only', () => {
    expect(extractBlogFaq(POST)).toEqual([
      {
        question: 'Czy kod QR wygasa?',
        answer: 'Nie. To stały kod przypisany do Twojego profilu.',
      },
      {
        question: 'Gdzie najlepiej powiesić kod?',
        answer:
          'Tam, gdzie klientka ma chwilę. Opisuję to w tekście QR na lustrze. Druga linia tego samego akapitu.',
      },
    ]);
  });

  it('keeps every paragraph of an answer that is not the last one', () => {
    const md = `## FAQ

### First?

Para one.

Para two.

### Last?

Answer.

Closing call to action.
`;
    expect(extractBlogFaq(md)).toEqual([
      { question: 'First?', answer: 'Para one. Para two.' },
      { question: 'Last?', answer: 'Answer.' },
    ]);
  });

  it('stops at the next section heading', () => {
    const md = `## Häufige Fragen

### Reicht Instagram?

Um gefunden zu werden, ja.

## Fazit

### Not a question

Text.
`;
    expect(extractBlogFaq(md)).toEqual([
      { question: 'Reicht Instagram?', answer: 'Um gefunden zu werden, ja.' },
    ]);
  });

  it('returns nothing for a post without an FAQ or with a question lacking an answer', () => {
    expect(extractBlogFaq('# Title\n\n## Section\n\nText.')).toEqual([]);
    expect(extractBlogFaq('## FAQ\n\n### Lonely question?\n')).toEqual([]);
  });
});

describe('markdownToPlainText', () => {
  it('drops inline markdown and keeps link labels', () => {
    expect(
      markdownToPlainText(
        'A **bold** and *em* word, `code`, [label](/x) and snake_case_name.'
      )
    ).toBe('A bold and em word, code, label and snake_case_name.');
  });
});

describe('buildBlogFaqJsonLd', () => {
  it('builds FAQPage for a post with an FAQ and null otherwise', () => {
    const jsonLd = buildBlogFaqJsonLd({
      markdown: POST,
      postUrl: 'https://nailfolio.app/blog/qr/',
      inLanguage: 'pl-PL',
    });
    expect(jsonLd?.['@type']).toBe('FAQPage');
    expect(jsonLd?.['@id']).toBe('https://nailfolio.app/blog/qr/#faq');
    expect(jsonLd?.mainEntity).toHaveLength(2);
    expect(jsonLd?.mainEntity[0]?.acceptedAnswer.text).toBe(
      'Nie. To stały kod przypisany do Twojego profilu.'
    );
    expect(
      buildBlogFaqJsonLd({
        markdown: 'No FAQ here.',
        postUrl: 'https://nailfolio.app/blog/x/',
        inLanguage: 'pl-PL',
      })
    ).toBeNull();
  });
});

describe('real posts', () => {
  const dir = path.join(process.cwd(), 'src', 'content', 'blog');
  const posts = fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.mdx'))
    .map(file => ({
      file,
      content: matter(fs.readFileSync(path.join(dir, file), 'utf-8')).content,
    }));

  it('every post with an FAQ heading yields its questions, without the closing call to action', () => {
    const withFaq = posts.filter(post =>
      /^##\s+(?:FAQ|Najczęstsze pytania|Häufige Fragen)\s*$/m.test(post.content)
    );
    expect(withFaq.length).toBeGreaterThan(0);
    for (const post of withFaq) {
      const items = extractBlogFaq(post.content);
      const questionCount = (
        post.content.split(
          /^##\s+(?:FAQ|Najczęstsze pytania|Häufige Fragen)\s*$/m
        )[1] ?? ''
      )
        .split(/^##\s/m)[0]
        ?.match(/^###\s/gm)?.length;
      expect(items.length, post.file).toBe(questionCount);
      const lastAnswer = items.at(-1)?.answer ?? '';
      expect(lastAnswer, post.file).not.toMatch(
        /darmowe konto|start for free|starten Sie kostenlos/i
      );
    }
  });
});
