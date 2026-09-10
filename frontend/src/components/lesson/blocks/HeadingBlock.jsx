// The page's <h1> is the lesson title, so the generator's level 1-3 maps one
// step down. Keeping the shift here means the prompt's numbering can stay
// natural without producing two <h1>s on the page.
const TAGS = { 1: 'h2', 2: 'h3', 3: 'h4' };

const STYLES = {
  1: 'text-xl font-bold text-ink mt-10 mb-3',
  2: 'text-lg font-semibold text-ink mt-8 mb-2',
  3: 'text-base font-semibold text-ink mt-6 mb-2',
};

export const HeadingBlock = ({ block }) => {
  const level = TAGS[block.level] ? block.level : 2;
  const Tag = TAGS[level];

  return <Tag className={STYLES[level]}>{block.text}</Tag>;
};
