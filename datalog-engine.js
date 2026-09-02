// Semi-naive datalog engine.
//
// Consumes the rules produced by the parser's `parse(code)` function:
//   rule = { conditions: [phrase, ...], statements: [{ type: 'claim' | 'wish', phrase }, ...] }
//   phrase = { signature: string, items: [item, ...] }
//   item = string (a constant, from a quoted literal)
//        | { type: 'symbol', name: string } (a variable)
//
// A "fact" has the same shape as a phrase, except every item is a ground
// constant (no unresolved symbols): { signature: string, items: [string, ...] }
//
// Facts are stored (and passed in/returned) as a dictionary keyed by
// signature, each value an array of item-tuples for that signature:
//   {
//     '_ is a part of _': [
//       ['property1', 'card2'],
//     ],
//   }
//
// Evaluation strategy (semi-naive): instead of rejoining every rule against
// every known fact each round, the engine tracks `full` (everything known
// as of the start of the round) separately from `delta` (only what was
// newly derived last round). Round 1 is a full/naive join over the seed
// facts alone (since with an empty `full`, no other option would find
// results needing 2+ seed-only conditions). From round 2 on, each rule is
// tried once per non-resolver condition, with that one condition drawing
// candidates from `delta` and every other condition drawing from `full` --
// this finds every derivation touching at least one new fact, without
// re-deriving anything reachable purely from old facts (already found in
// an earlier round). If a wish (via "_ is executed on _") appends a brand
// new rule mid-round, the *next* round is forced back into full/naive mode
// (over the whole rule set) so the new rule gets a fair first pass against
// everything accumulated so far.
//
// Resolvers let a signature be backed by code instead of a static fact list,
// for signatures with too many (or infinite) possible tuples to enumerate
// as claims (e.g. "point _ _ is inside of _"). A resolver is a function
// keyed by signature:
//   {
//     'point _ _ is inside of _': function (x, y, card) { ... },
//   }
// When a condition's signature has a resolver, the engine calls it with one
// argument per item position -- the item's current value if it's a bound
// symbol, a literal, or `undefined` if it's a
// still-unbound symbol. The resolver returns an array of tuples (each an
// array of values, one per item position, filling in any values it was
// asked to resolve); an empty array means no matches. Resolvers are never
// backed by `full`/`delta` (they're recomputed live every call), so they're
// never chosen as a rule's "delta position" during semi-naive rounds.
//
// Usage:
//   const facts = DatalogEngine.evaluate(rules, seedFacts, resolvers);

var DatalogEngine = (function () {
  // For persistant claims
  let memory = [];

  function updateMemory(factsToForget, factsToRemember) {
    // Forget facts
    const forgetKeySet = new Set();
    for(const fact of factsToForget)
      forgetKeySet.add(factKey(fact));
    memory = memory
      .filter(fact => !forgetKeySet.has(factKey(fact)));

    // Remember facts
    const existingMemoryKeySet = new Set();
    for(const fact of memory)
      existingMemoryKeySet.add(factKey(fact));
    for(const fact of factsToRemember)
      if(!existingMemoryKeySet.has(factKey(fact)))
        memory.push(fact);
  }

  function factKey(fact) {
    return fact.signature + '|' + fact.items.map(JSON.stringify).join('|');
  }

  // Substitute variable bindings into a phrase to produce a ground fact.
  function substitute(phrase, bindings) {
    return {
      signature: phrase.signature,
      items: phrase.items.map(function (item) {
        // TODO check usage of the function to determine if arrays can be blocked here
        if (typeof item === 'string' || typeof item === 'number' || Array.isArray(item)) {
          return item;
        }
        var value = bindings[item.name];
        if (value === undefined) {
          throw new Error('Unbound variable "' + item.name + '" in statement.');
        }
        return value;
      }),
    };
  }

  // Try to match a condition phrase against a known fact's items, extending
  // bindings. Returns the extended bindings on success, or null on failure.
  // (The signature is assumed to already match -- callers only reach here
  // via the fact dictionary entry for this exact signature, or a resolver
  // tuple stamped with this exact signature.)
  function matchCondition(condition, items, bindings) {
    if (condition.items.length !== items.length) return null;

    var next = Object.assign({}, bindings);

    for (var i = 0; i < condition.items.length; i++) {
      var conditionItem = condition.items[i];
      var factItem = items[i];

      if (typeof conditionItem === 'string' || typeof conditionItem === 'number') {
        if (conditionItem !== factItem) return null;
      } else {
        var existing = next[conditionItem.name];
        if (existing === undefined) {
          next[conditionItem.name] = factItem;
        } else if (existing !== factItem) {
          return null;
        }
      }
    }

    return next;
  }

  // Compute the current value for a condition item -- its literal,
  // or its bound value (undefined if not yet bound).
  function resolveArgument(item, bindings) {
    // TODO check usage of the function to determine if arrays can be blocked here
    if (typeof item === 'string' || typeof item === 'number' || Array.isArray(item)) return item;
    return bindings[item.name];
  }

  // Recursively try to satisfy every condition (in order), calling
  // onSolution(bindings) for each full set of bindings that works.
  // getCandidates(index, signature) supplies the tuples to try for a given
  // non-resolver condition -- this is how callers implement the full/delta
  // split for semi-naive rounds without solve() needing to know about it.
  function solve(conditions, index, bindings, getCandidates, resolvers, onSolution) {
    if (index === conditions.length) {
      onSolution(bindings);
      return;
    }
    var condition = conditions[index];
    var resolver = resolvers[condition.signature];

    // If condition is collected, prepare to collect
    const collector = {};
    if(condition.isCollected) {
      const newVariables = condition.items
        .filter(i => i.type === 'symbol' &&
                     bindings[i.name] === undefined);
      newVariables.forEach(symbol =>
        collector[symbol.name] = []);
    }

    if (resolver) {
      var args = condition.items.map(function (item) {
        return resolveArgument(item, bindings);
      });
      var tuples = resolver.apply(null, args) || [];

      tuples.forEach(function (tuple) {
        var next = matchCondition(condition, tuple, bindings);
        if (next) {
          if(condition.isCollected)
            for(const key in collector)
              collector[key].push(next[key]);
          else
            solve(conditions, index + 1, next, getCandidates, resolvers, onSolution);
        }
      });
    } else {
      var candidates = getCandidates(index, condition.signature);
      for (var i = 0; i < candidates.length; i++) {
        var next = matchCondition(condition, candidates[i], bindings);
        if (next) {
          if(condition.isCollected)
            for(const key in collector)
              collector[key].push(next[key]);
          else
            solve(conditions, index + 1, next, getCandidates, resolvers, onSolution);
        }
      }
    }
    
    if(condition.isCollected) {
      for(const key in collector)
        bindings[key] = collector[key];
      solve(conditions, index + 1, bindings, getCandidates, resolvers, onSolution);
    }
  }

  // Run semi-naive fixpoint evaluation (see header comment for the
  // algorithm). Wishes are not evaluated as goals -- they're just logged to
  // the console, handed to a granter, or (for "_ is executed on _") used to
  // load a script's claims/rules into the live evaluation.
  function evaluate(rules, seedFacts, resolvers, granters) {
    const startTime = Date.now();
    evalTime = 0;

    resolvers = resolvers || {};

    var full = {};    // everything known as of the start of the current round
    var delta = {};   // what was newly derived in the *previous* round
    var newDelta = {}; // what's being derived *this* round (becomes next round's delta)

    var factSet = new Set();
    var printedWishes = new Set();

    const factsToForget = [];
    const factsToRemember = [];
    // TODO try using sets to dedup these two collections to see if it increases performance

    function hasAnyFacts(dict) {
      return Object.keys(dict).length > 0;
    }

    function tryAddFact(dict, signature, items, source = null) {
      var key = factKey({ signature: signature, items: items });
      if(source) {
        // Add debug claim
        tryAddFact(dict, '_ claims _', [source, key]);
        // TODO this is going to cause recursion, so fix this soon
      }
      if (factSet.has(key)) return false;
      factSet.add(key);
      if (!dict[signature]) {
        dict[signature] = [];
      }
      dict[signature].push(items);
      return true;
    }

    // Bootstrap-round candidate lookup: every position draws from full ∪ delta.
    function combinedCandidates(index, signature) {
      return (full[signature] || []).concat(delta[signature] || []);
    }

    function applyStatements(rule, bindings) {
      rule.statements.forEach(function (statement) {
        if (statement.type === 'claim') {
          var fact = substitute(statement.phrase, bindings);
          tryAddFact(newDelta, fact.signature, fact.items, rule.source);
        } else if (statement.type === 'remember') {
          const memory = substitute(statement.phrase, bindings);
          factsToRemember.push(memory);
        } else if (statement.type === 'forget') {
          const memory = substitute(statement.phrase, bindings);
          factsToForget.push(memory);
        } else if (statement.type === 'wish') {
          var wish = substitute(statement.phrase, bindings);
          if (wish.signature in granters) {
            granters[wish.signature].apply(null, wish.items);
          } else {
            var key = 'wish:' + factKey(wish);
            if (!printedWishes.has(key)) {
              printedWishes.add(key);
              // TODO remove traces of printedWishes, but keep dedup

              if (wish.signature === '_ is executed on _') {
                const cardId = wish.items[1];

                let scriptItems = [];
                try {
                  scriptItems = Parser.parse(wish.items[0]);
                } catch(e) {
                  tryAddFact(newDelta, '_ failed to be parsed -> _', [cardId, e.toString()]);
                }

                scriptItems.forEach(function (item) {
                  // TODO for claims, forgets, and remembers, throw errors on unbound variables
                  if (item.type === 'claim') {
                    // Replace 'this' with card id
                    for (let i = 0; i < item.phrase.items.length; i++) {
                      const slot = item.phrase.items[i];
                      if (slot.type === 'symbol' &&
                          slot.name === 'this')
                        item.phrase.items[i] = cardId;
                    }
                    tryAddFact(newDelta, item.phrase.signature, item.phrase.items, cardId);
                  } else if (item.type === 'remember') {
                    // Replace 'this' with card id
                    for (let i = 0; i < item.phrase.items.length; i++) {
                      const slot = item.phrase.items[i];
                      if (slot.type === 'symbol' &&
                          slot.name === 'this')
                        item.phrase.items[i] = cardId;
                    }
                    // Add to remember list
                    factsToRemember.push(item.phrase);
                  } else if (item.type === 'forget') {
                    // Replace 'this' with card id
                    for (let i = 0; i < item.phrase.items.length; i++) {
                      const slot = item.phrase.items[i];
                      if (slot.type === 'symbol' &&
                          slot.name === 'this')
                        item.phrase.items[i] = cardId;
                    }
                    // Add to forget list
                    factsToForget.push(item.phrase);
                  } else if (item.type === 'rule') {
                    // Replace 'this' with card id
                    for (let i = 0; i < item.conditions.length; i++) {
                      const condition = item.conditions[i];
                      for (let j = 0; j < condition.items.length; j++) {
                        const slot = condition.items[j]
                        if (slot.type === 'symbol' &&
                            slot.name === 'this')
                          condition.items[j] = cardId;
                      }
                    }
                    for (let i = 0; i < item.statements.length; i++) {
                      const statement = item.statements[i];
                      for (let j = 0; j < statement.phrase.items.length; j++) {
                        const slot = statement.phrase.items[j]
                        if (slot.type === 'symbol' &&
                            slot.name === 'this')
                          statement.phrase.items[j] = cardId;
                      }
                    }
                    item.source = cardId; // so it can be referenced later for debugging
                    // A brand new rule has no evaluation history -- the
                    // round-loop below notices rules.length grew and
                    // forces a full/naive bootstrap round next time so
                    // this rule gets a fair first pass.
                    rules.push(item);
                  }
                });
              }
            }
          }
        }
      });
    }

    // Seed the initial delta with the seed facts.
    Object.entries(seedFacts || {}).forEach(function ([signature, tuples]) {
      tuples.forEach(function (items) {
        tryAddFact(delta, signature, items);
      });
    });

    // Merge memories into the delta
    memory.forEach(fact => {
      tryAddFact(delta, fact.signature, fact.items);
    });

    var forceBootstrap = true; // round 1 is always a full/naive bootstrap round

    while (forceBootstrap || hasAnyFacts(delta)) {
      newDelta = {};
      var bootstrapThisRound = forceBootstrap;
      forceBootstrap = false;

      var i = 0;
      while (i < rules.length) {
        var rule = rules[i];
        if(rule.defer) {
          // This rule is deferred. Skip it for now
          i++;
          continue;
        }
        var ruleCountBefore = rules.length;

        if (bootstrapThisRound) {
          solve(rule.conditions, 0, {}, combinedCandidates, resolvers, function (bindings) {
            applyStatements(rule, bindings);
          });
        } else {
          rule.conditions.forEach(function (condition, deltaIndex) {
            // TODO try skipping all non-recursive claims and see if it improves performance
            if (condition.signature in resolvers) {
              return; // resolvers are never the delta position -- they're always live
            }
            solve(
              rule.conditions,
              0,
              {},
              function (index, signature) {
                if(index > deltaIndex)
                  return combinedCandidates(index, signature);
                return (
                  index === deltaIndex
                    ? delta
                    : full
                )
                [signature] || [];
              },
              resolvers,
              function (bindings) {
                applyStatements(rule, bindings);
              });
          });
        }

        if (rules.length > ruleCountBefore) {
          forceBootstrap = true;
        }

        i++;
      }

      // Fold this round's delta into full, and promote what we just derived
      // to be next round's delta.
      Object.keys(delta).forEach(function (signature) {
        if (!full[signature]) {
          full[signature] = [];
        }
        full[signature] = full[signature].concat(delta[signature]);
      });
      delta = newDelta;
    }

    // Run deferred rules
    for(const rule of rules) {
      if(!rule.defer) continue;
      solve(rule.conditions, 0, {}, combinedCandidates, resolvers, function (bindings) {
        applyStatements(rule, bindings);
      });
    }

    // The loop only exits once delta is empty, but fold it in anyway for
    // clarity/safety.
    Object.keys(delta).forEach(function (signature) {
      if (!full[signature]) {
        full[signature] = [];
      }
      full[signature] = full[signature].concat(delta[signature]);
    });

    updateMemory(factsToForget, factsToRemember);

    const endTime = Date.now();
    console.log(`Ran for ${endTime - startTime} ms`);

    return full;
  }

  return {
    evaluate: evaluate,
  };

})();
