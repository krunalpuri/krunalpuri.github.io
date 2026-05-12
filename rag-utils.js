export async function loadReadmeKnowledge(knowledgeBase, readmePath = './README_AGENT.md') {
    try {
        const response = await fetch(readmePath);

        if (!response.ok) {
            console.warn(`README_AGENT.md not accessible. HTTP status: ${response.status}`);
            return;
        }

        const markdown = await response.text();

        const chunks = chunkReadmeBySection(markdown, {
            sourceName: 'README_AGENT.md',
            maxSectionChars: 1200,
            minChunkChars: 25
        });

        chunks.forEach((chunk) => {
            knowledgeBase.push({
                id: knowledgeBase.length,
                source: chunk.source,
                type: chunk.type,
                title: chunk.title,
                headingPath: chunk.headingPath,
                text: chunk.text
            });
        });

        console.log(`Loaded ${chunks.length} section-wise README_AGENT.md chunks.`);
        console.table(
            chunks.map(chunk => ({
                type: chunk.type,
                title: chunk.title,
                text: chunk.text.slice(0, 140)
            }))
        );
    } catch (error) {
        console.warn(
            'Could not load README_AGENT.md. If you are opening index.html with file://, run a local server such as: python3 -m http.server 8000',
            error
        );
    }
}

export function chunkReadmeBySection(markdown, options = {}) {
    const {
        sourceName = 'README_AGENT.md',
        maxSectionChars = 1200,
        minChunkChars = 25
    } = options;

    const sections = parseMarkdownSectionsByHeading(markdown);
    const chunks = [];

    function addChunk(type, title, headingPath, text) {
        const cleaned = cleanMarkdownText(text);

        if (cleaned.length < minChunkChars) return;

        chunks.push({
            source: sourceName,
            type,
            title,
            headingPath,
            text: `${sourceName} | ${title}: ${cleaned}`
        });
    }

    for (const section of sections) {
        const title = section.path.join(' > ') || 'README';
        const sectionText = cleanMarkdownText(section.content);

        if (!sectionText) continue;

        splitTextBySize(sectionText, maxSectionChars).forEach((piece, index) => {
            addChunk(
                index === 0 ? 'section' : 'section-continuation',
                title,
                section.path,
                piece
            );
        });

        const labeledChunks = extractLabeledSubsections(section.content);

        labeledChunks.forEach(item => {
            addChunk(
                `field-${slugify(item.label)}`,
                `${title} > ${item.label}`,
                section.path,
                `${item.label}: ${item.value}`
            );
        });
    }

    return dedupeReadmeChunks(chunks);
}

function parseMarkdownSectionsByHeading(markdown) {
    const lines = markdown.split(/\r?\n/);
    const sections = [];

    let headingStack = [];
    let currentSection = null;

    function startSection(level, title) {
        if (currentSection && cleanMarkdownText(currentSection.content)) {
            sections.push(currentSection);
        }

        headingStack = headingStack.slice(0, level - 1);
        headingStack[level - 1] = cleanMarkdownText(title);

        currentSection = {
            level,
            path: headingStack.filter(Boolean),
            content: ''
        };
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

        if (headingMatch) {
            const level = headingMatch[1].length;
            const title = headingMatch[2];

            startSection(level, title);
            continue;
        }

        if (!currentSection) {
            currentSection = {
                level: 0,
                path: ['README'],
                content: ''
            };
        }

        currentSection.content += `${rawLine}\n`;
    }

    if (currentSection && cleanMarkdownText(currentSection.content)) {
        sections.push(currentSection);
    }

    return sections;
}

function extractLabeledSubsections(sectionMarkdown) {
    const lines = sectionMarkdown.split(/\r?\n/);
    const results = [];

    let currentLabel = null;
    let currentValueLines = [];

    function flush() {
        if (!currentLabel) return;

        const value = cleanMarkdownText(currentValueLines.join(' '));

        if (value) {
            results.push({
                label: currentLabel,
                value
            });
        }

        currentLabel = null;
        currentValueLines = [];
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line) continue;

        const labelMatch = line.match(/^([A-Za-z][A-Za-z0-9 &/+-]{1,60}):\s*(.*)$/);

        if (labelMatch) {
            flush();

            currentLabel = cleanMarkdownText(labelMatch[1]);
            const inlineValue = cleanMarkdownText(labelMatch[2]);

            if (inlineValue) {
                currentValueLines.push(inlineValue);
            }

            continue;
        }

        if (currentLabel) {
            const bulletMatch = line.match(/^[-*+]\s+(.+)$/);
            const orderedMatch = line.match(/^\d+\.\s+(.+)$/);

            if (bulletMatch) {
                currentValueLines.push(cleanMarkdownText(bulletMatch[1]));
            } else if (orderedMatch) {
                currentValueLines.push(cleanMarkdownText(orderedMatch[1]));
            } else {
                currentValueLines.push(cleanMarkdownText(line));
            }
        }
    }

    flush();

    return results;
}

function cleanMarkdownText(text) {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .replace(/^#+\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitTextBySize(text, maxChars = 1200) {
    const cleaned = cleanMarkdownText(text);

    if (!cleaned) return [];

    if (cleaned.length <= maxChars) {
        return [cleaned];
    }

    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
        const next = current ? `${current} ${sentence}` : sentence;

        if (next.length > maxChars) {
            if (current.trim()) {
                chunks.push(current.trim());
            }

            if (sentence.length > maxChars) {
                chunks.push(...hardSplitText(sentence, maxChars));
                current = '';
            } else {
                current = sentence;
            }
        } else {
            current = next;
        }
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks;
}

function hardSplitText(text, maxChars = 1200) {
    const words = cleanMarkdownText(text).split(/\s+/);
    const chunks = [];
    let current = '';

    for (const word of words) {
        const next = current ? `${current} ${word}` : word;

        if (next.length > maxChars) {
            if (current.trim()) {
                chunks.push(current.trim());
            }
            current = word;
        } else {
            current = next;
        }
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks;
}

function dedupeReadmeChunks(chunks) {
    const seen = new Set();

    return chunks.filter(chunk => {
        const key = `${chunk.type}|${chunk.title}|${chunk.text}`.toLowerCase();

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function slugify(text) {
    return cleanMarkdownText(text)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'field';
}