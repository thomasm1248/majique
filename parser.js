var Parser = (function () {

  const codeRegex = /(?<isWhitespace>\s+)|(?<isComment>;[^\n]*)|[,:.[\]()]|"[^\\"]*(\\.[^\\"]*)*"|(?<isNumber>-?\d[\d.]*)|[^\s,:.[\]()]+/g;

  // Private functions

  function parsePhrase(phrase) {
    const matches = phrase?.matchAll(phraseRegex)
      ?.map(match => ({
        ...match.groups,
        index: match.index,
        length: match[0].length,
      }))
      .toArray();
    if(!matches)
      throw new Error(`Expected a phrase, got "${phrase ?? ''}".`);
    let i = 0;
    let signature = '';
    let items = [];
    for(const match of matches) {
      signature += phrase.substring(i, match.index);
      signature += '_';
      i = match.index + match.length;
      if(match.string) {
        items.push(JSON.parse(match.string));
      } else if(match.expr) {
        items.push(
          // If starts with digit or '-', number
          /^[\d-]/.test(match.expr) ? JSON.parse(match.expr) :
          // Otherwise, symbol
          { type: 'symbol', name: match.expr }
        );
      } else {
        throw new Error(`Invalid phrase: ${phrase}`);
      }
    }
    signature += phrase.substring(i);
    return {
      signature,
      items,
    };
  }

  // Public functions

  function parse(code) {
    // Parse and classify tokens
    const tokens = code.matchAll(codeRegex)
      .filter(m => !m.groups.isWhitespace)
      .filter(m => !m.groups.isComment)
      .map(m => {
        const text = m[0];
        if(text.startsWith('"') || m.groups.isNumber)
          return { type: 'value', value: JSON.parse(text) };
        if(text.length === 1 && ',:.[]()'.indexOf(text) !== -1)
          return { type: 'delimiter', character: text };
        return { type: 'symbol', name: text.toLowerCase() };
      })
      .toArray();
    // Prepare to read tokens
    let i = 0;
    function peekNext() {
      return tokens[i];
    }
    function takeNext() {
      return tokens[i++];
    }
    function hasNext() {
      return i < tokens.length;
    }
    // Functions for parsing program using recursive-descent
    // If a function's name starts with 'try', it returns
    // null on failure instead of throwing an exception.
    function parseSlotContents() {
      // Check for number/string
      const nextToken = peekNext();
      if(nextToken.type === 'value') {
        takeNext();
        return nextToken.value;
      }

      // Parse multi-word symbol
      const words = [];
      while(true) {
        const token = peekNext();
        if(token.type === 'symbol') {
          takeNext();
          words.push(token.name);
          continue;
        }
        if(token.type === 'value') {
          takeNext();
          words.push(token.value.toString());
          continue;
        }
        break;
      }
      return { type: 'symbol', name: words.join(' ') };
    }
    function parsePhrase() {
      const signatureParts = [];
      const items = [];

      while(true) {
        const nextToken = peekNext();
        
        // Symbols
        if(nextToken.type === 'symbol') {
          takeNext();
          signatureParts.push(nextToken.name);
          continue;
        }

        // Values
        if(nextToken.type === 'value') {
          takeNext();
          signatureParts.push('_');
          items.push(nextToken.value);
          continue;
        }
        
        // Slots
        if(nextToken.type === 'delimiter' &&
           nextToken.character === '(') {
          takeNext();
          signatureParts.push('_');
          items.push(parseSlotContents());
          const closingParen = takeNext();
          if(closingParen.type !== 'delimiter' ||
             closingParen.character !== ')')
            throw new Error('A condition slot was not closed with a ")".');
          continue;
        }

        // Delimiters
        if(nextToken.type === 'delimiter') {
          break;
        }

        // Unknown
        throw new Error('Every phrase must end in a delimiter.');
        // This is probably not possible.
      }

      return {
        signature: signatureParts.join(' '),
        items,
      };
    }
    function tryParseStatement() {
      const nextToken = peekNext();
      if(nextToken.type !== 'symbol') return null;
      switch(nextToken.name) {
        case 'claim':
        case 'wish':
        case 'remember':
        case 'forget':
          takeNext();
          const statement = {
            type: nextToken.name,
            phrase: parsePhrase(),
          };
          const period = takeNext();
          if(period.type !== 'delimiter' &&
             period.character !== '.')
            throw new Error('A statement did not end with a period.');
          return statement;
        default:
          return null;
      }
    }
    function tryParseRule() {
      // Check for 'when'
      const whenToken = peekNext();
      if(whenToken.type !== 'symbol' ||
         whenToken.name !== 'when')
        return null;
      takeNext(); // discard the 'when'

      // Read conditions
      const conditions = [];
      let hasACollectedCondition = false;
      while(true) {
        // Check for [
        const nextToken = peekNext();
        const isCollected = nextToken.type === 'delimiter' &&
                            nextToken.character === '[';
        if(isCollected) takeNext();

        // Read phrase
        const phrase = parsePhrase();
        conditions.push(phrase);

        // Check for ]
        if(isCollected) {
          const collectorClose = takeNext();
          if(collectorClose.type !== 'delimiter' ||
             collectorClose.character !== ']')
            throw new Error('Collection must end with "]".');
          phrase.isCollected = true;
          hasACollectedCondition = true;
        }

        // Read ',' or ':'
        const finalToken = takeNext();
        if(finalToken.type !== 'delimiter')
          throw new Error('A condition in a "when" block did not' +
            ' end with either a comma or colon.');
        if(finalToken.character === ',')
          continue;
        if(finalToken.character === ':')
          break;
        throw new Error('A condition in a "when" block did not' +
          ' end with either a comma or colon.');
      }

      // Read statements
      const statements = [];
      while(true) {
        const statement = tryParseStatement();
        if(!statement)
          break;

        // For for illegal claims
        if(statement.type === 'claim' &&
           hasACollectedCondition)
          throw new Error("'When' blocks with a collector [...] cannot contains Claims.");

        statements.push(statement);
      }

      // Check for 'end'
      const endToken = takeNext();
      if(endToken.type !== 'symbol' ||
         endToken.name !== 'end')
        throw new Error("'When' block did not end with 'end'.");

      return {
        type: 'rule',
        conditions,
        statements,
        defer: hasACollectedCondition,
      };
    }
    function parseProgram() {
      const items = [];
      while(hasNext()) {
        // Parse a statement?
        const statement = tryParseStatement();
        if(statement) {
          items.push(statement);
          continue;
        }

        // Parse a rule?
        const rule = tryParseRule();
        if(rule) {
          items.push(rule);
          continue;
        }

        // Oh no, unidentified code
        throw new Error(`Expected either "When", "Claim", "Wish",` +
          ` "Remember", or "Forget", but got "${peekNext()}".`);
      }
      return items;
    }
    return parseProgram();
  }

  return {
    parse: parse,
  };

})();
