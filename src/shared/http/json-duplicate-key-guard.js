function whitespace(
  character,
) {
  return (
    character === ' ' ||
    character === '\n' ||
    character === '\r' ||
    character === '\t'
  );
}

export function findDuplicateJsonKeys(
  input,
) {
  const text =
    String(input ?? '');
  const duplicates = [];
  let index = 0;

  function skipWhitespace() {
    while (
      index < text.length &&
      whitespace(
        text[index],
      )
    ) {
      index += 1;
    }
  }

  function parseString() {
    if (text[index] !== '"') {
      throw new SyntaxError(
        'Expected JSON string',
      );
    }

    const start =
      index;
    index += 1;

    while (index < text.length) {
      const character =
        text[index];

      if (character === '"') {
        index += 1;
        return JSON.parse(
          text.slice(
            start,
            index,
          ),
        );
      }

      if (character === '\\') {
        index += 1;
        if (
          text[index] === 'u'
        ) {
          index += 5;
        } else {
          index += 1;
        }
        continue;
      }

      index += 1;
    }

    throw new SyntaxError(
      'Unterminated JSON string',
    );
  }

  function parseScalar() {
    const start =
      index;

    while (
      index < text.length &&
      !whitespace(
        text[index],
      ) &&
      ![
        ',',
        ']',
        '}',
      ].includes(
        text[index],
      )
    ) {
      index += 1;
    }

    JSON.parse(
      text.slice(
        start,
        index,
      ),
    );
  }

  function pathLabel(
    path,
    key,
  ) {
    return [
      ...path,
      key,
    ].join('.');
  }

  function parseArray(path) {
    index += 1;
    skipWhitespace();

    if (text[index] === ']') {
      index += 1;
      return;
    }

    let itemIndex = 0;

    while (index < text.length) {
      parseValue([
        ...path,
        String(
          itemIndex,
        ),
      ]);
      itemIndex += 1;
      skipWhitespace();

      if (text[index] === ']') {
        index += 1;
        return;
      }

      if (text[index] !== ',') {
        throw new SyntaxError(
          'Expected JSON array separator',
        );
      }

      index += 1;
      skipWhitespace();
    }

    throw new SyntaxError(
      'Unterminated JSON array',
    );
  }

  function parseObject(path) {
    index += 1;
    skipWhitespace();

    if (text[index] === '}') {
      index += 1;
      return;
    }

    const keys =
      new Set();

    while (index < text.length) {
      const key =
        parseString();

      if (keys.has(key)) {
        duplicates.push(
          pathLabel(
            path,
            key,
          ),
        );
      } else {
        keys.add(key);
      }

      skipWhitespace();

      if (text[index] !== ':') {
        throw new SyntaxError(
          'Expected JSON object colon',
        );
      }

      index += 1;
      parseValue([
        ...path,
        key,
      ]);
      skipWhitespace();

      if (text[index] === '}') {
        index += 1;
        return;
      }

      if (text[index] !== ',') {
        throw new SyntaxError(
          'Expected JSON object separator',
        );
      }

      index += 1;
      skipWhitespace();
    }

    throw new SyntaxError(
      'Unterminated JSON object',
    );
  }

  function parseValue(path) {
    skipWhitespace();

    if (text[index] === '{') {
      parseObject(path);
      return;
    }

    if (text[index] === '[') {
      parseArray(path);
      return;
    }

    if (text[index] === '"') {
      parseString();
      return;
    }

    parseScalar();
  }

  try {
    parseValue([]);
    skipWhitespace();

    if (index !== text.length) {
      return [];
    }
  } catch {
    // Syntax errors are handled by express.json itself.
    return [];
  }

  return [
    ...new Set(
      duplicates,
    ),
  ].slice(0, 32);
}

export function verifyNoDuplicateJsonKeys(
  _request,
  _response,
  buffer,
  encoding,
) {
  const normalizedEncoding =
    String(
      encoding ??
      'utf-8',
    ).toLocaleLowerCase(
      'en-US',
    ) === 'utf-8'
      ? 'utf8'
      : encoding;

  const duplicates =
    findDuplicateJsonKeys(
      buffer.toString(
        normalizedEncoding ||
        'utf8',
      ),
    );

  if (duplicates.length === 0) {
    return;
  }

  const error =
    new SyntaxError(
      'Duplicate JSON object keys are not allowed',
    );
  error.status = 400;
  error.type =
    'entity.duplicate.json.key';
  error.duplicateJsonKeys =
    duplicates;
  throw error;
}
