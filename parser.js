var Parser = (function () {

  // TODO honestly, the whole parser needs to be redone
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
    const tokens = code.matchAll(codeRegex)
      .filter(m => !m.groups.isWhitespace)
      .filter(m => !m[0].startsWith(';'))
      .map(m => m[0])
      .toArray();
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
    function parseTopLevelClaim() {
      if(takeNext() !== 'Claim')
        throw new Error('Expected "Claim".');
      const phrase = parsePhrase(takeNext());
      if(takeNext() !== '.')
        throw new Error("Claims must end with '.'.");
      return {
        type: 'claim',
        phrase,
      };
    }
    function parseRule() {
      if(peekNext() !== 'When')
        throw new Error('Expected "When".');
      const conditions = [];
      let hasACollectedCondition = false;
      while(takeNext() !== ':') {
        const isCollected = peekNext() === '[';
        if(isCollected) takeNext();
        const phrase = parsePhrase(takeNext());
        conditions.push(phrase);
        if(isCollected) {
          if(takeNext() !== ']')
            throw new Error('Collection must end with "]".');
          phrase.isCollected = true;
          hasACollectedCondition = true;
        }
      }
      const statements = [];
      while(peekNext() !== 'End') {
        switch(peekNext()) {
          case 'Claim':
            if(hasACollectedCondition)
              throw new Error("'When' blocks with a collector [...] cannot contains Claims.");
            takeNext();
            statements.push({
              type: 'claim',
              phrase: parsePhrase(takeNext()),
            });
            if(takeNext() !== '.')
              throw new Error("Claims must end with '.'.");
            break;
          case 'Wish':
            takeNext();
            statements.push({
              type: 'wish',
              phrase: parsePhrase(takeNext()),
            });
            if(takeNext() !== '.')
              throw new Error("Wishes must end with '.'.");
            break;
          // TODO add Remember and Forget
          default:
            throw new Error('Expected either Claim or Wish.');
        }
      }
      takeNext();
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
        switch(peekNext()) {
          case 'Claim':
            items.push(parseTopLevelClaim());
            break;
          case 'When':
            items.push(parseRule());
            break;
          // TODO add Wish, Remember, and Forget
          default:
            throw new Error(`Expected either "Claim" or "When", got "${peekNext()}".`);
        }
      }
      return items;
    }
    return parseProgram();
  }

  return {
    parse: parse,
  };

})();
