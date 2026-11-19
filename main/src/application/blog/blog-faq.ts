/**
 * FAQ extraction from a blog post's raw markdown, for the post's `FAQPage` JSON-LD. Pure (no fs).
 *
 * Posts write an FAQ as `## FAQ | ## Najczęstsze pytania | ## Häufige Fragen`, then `### <question>`
 * followed by answer paragraphs, then the post's closing call to action.
 *
 * DECISION: the JSON-LD carries ONLY the post's own question and answer text. An answer is every
 * paragraph up to the next `###`, EXCEPT after the last question: there only the first paragraph
 * counts, because each post closes its FAQ section with the call to action. Markdown is reduced to
 * plain text (links keep their label). No complete Q&A pair means no FAQPage at all.
 */

export type BlogFaqItem = {
  question: string;
  answer: string;
};

/** Section headings that open a post's FAQ, per locale the blog is written in. */
const FAQ_HEADING =
  /^##\s+(?:FAQ|Frequently asked questions|Najczęstsze pytania|Częste pytania|Häufige Fragen|Häufig gestellte Fragen)\s*:?\s*$/i;
const SECTION_HEADING = /^#{1,2}\s/;
const QUESTION_HEADING = /^###\s+(.+?)\s*#*\s*$/;

/** Markdown inline syntax → plain text (links keep their label). */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitParagraphs(lines: ReadonlyArray<string>): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line.trim());
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs;
}

/** The FAQ of a post's raw markdown; empty when the post has none. */
export function extractBlogFaq(markdown: string): BlogFaqItem[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => FAQ_HEADING.test(line.trim()));
  if (start === -1) {
    return [];
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_HEADING.test(line)) {
      break;
    }
    sectionLines.push(line);
  }

  const blocks: Array<{ question: string; body: string[] }> = [];
  for (const line of sectionLines) {
    const heading = QUESTION_HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      blocks.push({ question: heading[1], body: [] });
      continue;
    }
    blocks.at(-1)?.body.push(line);
  }

  return blocks.flatMap((block, index) => {
    const paragraphs = splitParagraphs(block.body);
    const answerParagraphs =
      index === blocks.length - 1 ? paragraphs.slice(0, 1) : paragraphs;
    const question = markdownToPlainText(block.question);
    const answer = markdownToPlainText(answerParagraphs.join('\n\n'));
    return question !== '' && answer !== '' ? [{ question, answer }] : [];
  });
}

export type BlogFaqJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'FAQPage';
  '@id': string;
  inLanguage: string;
  mainEntity: ReadonlyArray<{
    '@type': 'Question';
    name: string;
    acceptedAnswer: { '@type': 'Answer'; text: string };
  }>;
};

/** `FAQPage` JSON-LD for a post, or null when its markdown has no FAQ. */
export function buildBlogFaqJsonLd({
  markdown,
  postUrl,
  inLanguage,
}: {
  markdown: string;
  postUrl: string;
  inLanguage: string;
}): BlogFaqJsonLd | null {
  const items = extractBlogFaq(markdown);
  if (items.length === 0) {
    return null;
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${postUrl}#faq`,
    inLanguage,
    mainEntity: items.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}
