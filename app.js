// Simple drag-and-drop + click-to-highlight + click-to-edit for .card elements.
// Right-click on the background creates a new card with the same behavior.

// TODO switch to plugin-oriented architecture.

const INTERVAL_MS = 100;

var editingCard = null;
var cardCount = 0;
const cardDict = {};
let mouseX = 0, mouseY = 0;

function exitEditMode() {
  if (editingCard) {
    var textarea = editingCard.querySelector('.card-textarea');
    var newText = textarea ? textarea.value : '';

    editingCard.innerHTML = '';
    var p = document.createElement('p');
    p.textContent = newText;
    editingCard.appendChild(p);

    delete editingCard.dataset.originalText;
    editingCard.classList.remove('editing');
    editingCard = null;
  }
}

function enterEditMode(card) {
  var currentText = card.textContent.trim();
  card.dataset.originalText = currentText;

  card.innerHTML = '';
  var textarea = document.createElement('textarea');
  textarea.className = 'card-textarea';
  textarea.value = currentText;
  card.appendChild(textarea);

  card.classList.add('editing');
  editingCard = card;
  textarea.focus();
}

function setupCard(card) {
  var offsetX = 0;
  var offsetY = 0;
  var dragging = false;
  var moved = false;
  var startX = 0;
  var startY = 0;

  card.addEventListener('mousedown', function (e) {
    if(!editingCard || editingCard !== card)
      document.body.appendChild(card); // bring to front

    // Starting to interact with a different card ends editing on the current one.
    if (editingCard && editingCard !== card)
      exitEditMode();

    // Don't start a drag if we're clicking inside the card that's being edited
    // (e.g. clicking into the textarea to place the cursor).
    if (editingCard === card)
      return;

    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    offsetX = e.clientX - card.offsetLeft;
    offsetY = e.clientY - card.offsetTop;
  });

  document.addEventListener('mousemove', function (e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!dragging) return;
    if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3)
      moved = true;
    card.style.left = (e.clientX - offsetX) + 'px';
    card.style.top = (e.clientY - offsetY) + 'px';
  });

  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;

    if (!moved) {
      if (card.classList.contains('active')) {
        // Clicking an already-highlighted card enters edit mode.
        enterEditMode(card);
      } else {
        document.querySelectorAll('.card').forEach(function (c) {
          c.classList.remove('active');
        });
        card.classList.add('active');
      }
    }
  });
}

function createCard(x, y) {
  cardCount++;

  var card = document.createElement('div');
  card.className = 'card';
  card.id = 'card' + cardCount;
  card.style.left = x + 'px';
  card.style.top = y + 'px';

  var p = document.createElement('p');
  p.textContent = '';
  card.appendChild(p);

  document.body.appendChild(card);
  setupCard(card);

  cardDict[card.id] = card;

  return card;
}

// Right-click on the background creates a new card.
document.addEventListener('contextmenu', function (e) {
  if (e.target.closest('.card') || e.target.closest('#toolbox-panel') || e.target.closest('#toolbox-toggle'))
    return;
  e.preventDefault();
  createCard(e.clientX, e.clientY);
});

// Clicking the background ends editing on whatever card was being edited.
document.addEventListener('mousedown', function (e) {
  if (editingCard && !editingCard.contains(e.target))
    exitEditMode();
});

// Backspace deletes the highlighted card, but only when not editing.
document.addEventListener('keydown', function (e) {
  if ((e.key !== 'Backspace' && e.key !== 'Delete') || editingCard) return;

  var active = document.querySelector('.card.active');
  if (active) {
    e.preventDefault();
    active.remove();
    delete cardDict[active.id];
  }
});

// --- Toolbox: a small reusable-card palette in the top-left corner. ---
// Items are either { type: 'card', title, text } or
// { type: 'folder', title, children: [...] }. "Recreating" a card means
// spawning a fresh card and setting its content to the stored text, not
// restoring the original DOM element (which may no longer exist).
// Persisted to localStorage so the toolbox survives a page reload.

var TOOLBOX_STORAGE_KEY = 'toolboxItems';

// Older saves are a flat array of { title, text } with no `type` -- treat
// anything without an explicit type as a card.
function normalizeToolboxItem(item) {
  if (item && item.type === 'folder') {
    return {
      type: 'folder',
      title: item.title,
      children: Array.isArray(item.children) ? item.children.map(normalizeToolboxItem) : [],
    };
  }
  return { type: 'card', title: item.title, text: item.text };
}

function loadToolboxItems() {
  try {
    var raw = localStorage.getItem(TOOLBOX_STORAGE_KEY);
    var items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items.map(normalizeToolboxItem) : [];
  } catch (e) {
    console.warn('Failed to load toolbox items from localStorage:', e);
    return [];
  }
}

function saveToolboxItems() {
  try {
    localStorage.setItem(TOOLBOX_STORAGE_KEY, JSON.stringify(toolboxItems));
  } catch (e) {
    console.warn('Failed to save toolbox items to localStorage:', e);
  }
}

// Count every card nested anywhere inside a folder (recursing into
// sub-folders), for the "N cards will be deleted" confirmation.
function countCards(folder) {
  var count = 0;
  folder.children.forEach(function (child) {
    count += child.type === 'folder' ? countCards(child) : 1;
  });
  return count;
}

var toolboxItems = loadToolboxItems(); // root-level list
var toolboxPath = []; // stack of folder objects -- current view is the last one's children (or the root)

function currentToolboxChildren() {
  return toolboxPath.length ? toolboxPath[toolboxPath.length - 1].children : toolboxItems;
}

var toolboxToggle = document.getElementById('toolbox-toggle');
var toolboxPanel = document.getElementById('toolbox-panel');
var toolboxBack = document.getElementById('toolbox-back');
var toolboxList = document.getElementById('toolbox-list');
var toolboxAdd = document.getElementById('toolbox-add');
var toolboxCreateFolder = document.getElementById('toolbox-create-folder');

toolboxToggle.addEventListener('click', function () {
  toolboxPanel.classList.toggle('hidden');
});

function renderToolboxItem(item, parentArray) {
  var el = document.createElement('div');
  el.className = 'toolbox-item' + (item.type === 'folder' ? ' toolbox-folder' : '');
  el.title = item.title;

  var titleSpan = document.createElement('span');
  titleSpan.textContent = (item.type === 'folder' ? '\ud83d\udcc1 ' : '') + item.title;
  el.appendChild(titleSpan);

  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'toolbox-item-delete';
  deleteBtn.textContent = '\u00d7';
  deleteBtn.title = 'Remove from toolbox';
  deleteBtn.draggable = false;
  el.appendChild(deleteBtn);

  if (item.type === 'folder') {
    el.addEventListener('click', function () {
      toolboxPath.push(item);
      renderToolboxList();
    });
  } else {
    el.draggable = true;
    el.addEventListener('dragstart', function (e) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', item.text);
    });
  }

  deleteBtn.addEventListener('mousedown', function (e) {
    e.stopPropagation();
  });

  deleteBtn.addEventListener('click', function (e) {
    e.stopPropagation();

    if (item.type === 'folder') {
      var count = countCards(item);
      if (count > 0 && !confirm(count + ' card' + (count === 1 ? '' : 's') + ' will be deleted. Continue?')) {
        return;
      }
    }

    var index = parentArray.indexOf(item);
    if (index !== -1) {
      parentArray.splice(index, 1);
    }
    saveToolboxItems();
    renderToolboxList();
  });

  return el;
}

function renderToolboxList() {
  toolboxList.innerHTML = '';
  currentToolboxChildren().forEach(function (item) {
    toolboxList.appendChild(renderToolboxItem(item, currentToolboxChildren()));
  });
  toolboxBack.style.display = toolboxPath.length ? 'block' : 'none';
}

toolboxBack.addEventListener('click', function () {
  toolboxPath.pop();
  renderToolboxList();
});

toolboxAdd.addEventListener('click', function () {
  var active = document.querySelector('.card.active');
  if (!active) {
    return;
  }

  var text = getCardText(active);
  var title = (text.split('\n')[0] || '').trim() || '(untitled)';

  currentToolboxChildren().push({ type: 'card', title: title, text: text });
  saveToolboxItems();
  renderToolboxList();
});

toolboxCreateFolder.addEventListener('click', function () {
  var name = prompt('Folder name:');
  if (!name) {
    return;
  }

  currentToolboxChildren().push({ type: 'folder', title: name.trim() || 'Untitled', children: [] });
  saveToolboxItems();
  renderToolboxList();
});

renderToolboxList();

// Dropping a toolbox item onto the main area recreates the card it came from.
document.addEventListener('dragover', function (e) {
  e.preventDefault();
});

document.addEventListener('drop', function (e) {
  if (e.target.closest('#toolbox-panel') || e.target.closest('#toolbox-toggle')) {
    return;
  }
  e.preventDefault();

  var text = e.dataTransfer.getData('text/plain');
  if (!text) {
    return;
  }

  var card = createCard(e.clientX, e.clientY);
  var p = card.querySelector('p');
  if (p) {
    p.textContent = text;
  }
});

// Every second, describe the current cards as claims and run them through
// the datalog engine. The response is currently ignored -- this just keeps
// the engine fed with a fresh snapshot of the world.
//
// Claims generated per card:
//   (card) is a card                     -> signature "_ is a card"
//   (card) is located at (x) (y)         -> signature "_ is located at _ _"
//   the content of (card) is (text)      -> signature "the content of _ is _"

function getCardText(card) {
  if (card.classList.contains('editing'))
    return card.dataset.originalText || '';
  return card.textContent.trim();
}

function buildCardClaims() {
  var claims = {};

  function addClaim(signature, items) {
    if (!claims[signature])
      claims[signature] = [];
    claims[signature].push(items);
  }

  document.querySelectorAll('.card').forEach(function (card) {
    var id = card.id;
    var centerX = Math.round(card.offsetLeft + card.offsetWidth / 2);
    var centerY = Math.round(card.offsetTop + card.offsetHeight / 2);
    var text = getCardText(card);

    addClaim('_ is a card', [id]);
    addClaim('_ is located at _ _', [id, centerX, centerY]);
    addClaim('the content of _ is _', [id, text]);
  });

  return claims;
}

// Merge two claim dictionaries (signature -> array of item-tuples) into one.
function mergeClaims(a, b) {
  var merged = {};
  [a, b].forEach(function (claims) {
    Object.keys(claims).forEach(function (signature) {
      if (!merged[signature])
        merged[signature] = [];
      merged[signature] = merged[signature].concat(claims[signature]);
    });
  });
  return merged;
}

setInterval(function () {
  var program = Parser.parse(BootstrapScript);
  var rules = program.filter(function (item) {
    return item.type === 'rule';
  });
  var bootstrapClaims = {};
  program.forEach(function (item) {
    if (item.type === 'claim') {
      var signature = item.phrase.signature;
      if (!bootstrapClaims[signature])
        bootstrapClaims[signature] = [];
      bootstrapClaims[signature].push(item.phrase.items);
    }
  });

  var claims = mergeClaims(buildCardClaims(), bootstrapClaims);

  // System claims
  claims['mouse is at _ _'] = [[mouseX, mouseY]];
  claims['current time is _'] = [[Date.now()]];

  resetCanvas();
  const cardBackgroundColors = {};

  var result = DatalogEngine.evaluate(rules, claims, {
    'point _ _ is inside of _': function (x, y, card) {
      if (x === undefined || y === undefined)
        throw new Error('point _ _ is inside of _ requires x and y');
      if (card !== undefined)
        return intersects(x, y, card) ? [[x, y, card]] : [];
      return Object.keys(cardDict)
        .filter(id => intersects(x, y, id))
        .map(c => [x, y, c]);
    },
    '_ is a number from _ to _': function (x, start, end) {
      if (start === undefined || end === undefined)
        throw new Error('"(x) is a number from (start) to' +
          ' (end)" requires start and end.');
      if(x !== undefined) {
        if(x < start || x > end)
          return [];
        else
          return [[x, start, end]];
      } else {
        const nums = [];
        for(let i = start; i <= end; i++)
          nums.push(i);
        return nums
          .map(n => [n, start, end]);
      }
    },
    '_ is not _': function (a, b) {
      if (a === undefined || b === undefined)
        throw new Error('"(a) is not (b)" requires both a and b.');
      if (a === b)
        return [];
      else
        return [[a, b]];
    },
    '_ is _': function (a, b) {
      if (a === undefined || b === undefined)
        throw new Error('"(a) is (b)" requires both a and b.');
      if (a === b)
        return [[a, b]];
      else
        return [];
    },
    '_ starts with _': function (text, string) {
      if(text === undefined || string === undefined)
        throw new Error('"(text) starts with (string)" requires both text and string.');
      if(text.startsWith(string))
        return [[text, string]];
      else
        return [];
    },
    'split _ at _ to get _ and _': function (text, index, first, second) {
      if(text === undefined || index === undefined)
        throw new Error('"split (text) at (index) to get' +
          ' (first) and (second)" requires both text and index.');
      const firstHalf = text.substring(0, index);
      const secondHalf = text.substring(index);
      if(first !== undefined && first !== firstHalf)
        return [];
      if(second !== undefined && second !== secondHalf)
        return [];
      return [[text, index, firstHalf, secondHalf]];
    },
    '_ is line _ of _': function (line, num, text) {
      if(text === undefined)
        throw new Error('"(line) is line (num) of (text)" requires text.');
      const lines = text.split('\n');
      if(num !== undefined) {
        const index = num - 1;
        if(index < 0 || index >= lines.length)
          return [];
        if(line !== undefined && line !== lines[index])
          return [];
        return [[lines[index], num, text]];
      }
      if(line !== undefined) {
        return lines
          .map((l, i) => [l, i + 1, text])
          .filter(([l]) => l === line);
      }
      return lines.map((l, i) => [l, i + 1, text]);
    },
    '_ + _ = _': function(a, b, c) {
      const numberIfUnknowns = [a, b, c]
        .filter(x => x === undefined)
        .length;
      if(numberIfUnknowns > 1)
        throw new Error(`"(a) + (b) = (c)" can handle at most one unknown.`);
      if(numberIfUnknowns === 0) {
        if(a + b === c)
          return [[a, b, c]];
        else
          return [];
      }
      if(a === undefined)
        return [[c - b, b, c]];
      if(b === undefined)
        return [[a, c - a, c]];
      if(c === undefined)
        return [[a, b, a + b]];
    },
    '_ * _ = _': function(a, b, c) {
      const numberIfUnknowns = [a, b, c]
        .filter(x => x === undefined)
        .length;
      if(numberIfUnknowns > 1)
        throw new Error(`"(a) * (b) = (c)" can handle at most one unknown.`);
      if(numberIfUnknowns === 0) {
        if(a * b === c)
          return [[a, b, c]];
        else
          return [];
      }
      if(a === undefined)
        return [[c / b, b, c]];
      if(b === undefined)
        return [[a, c / a, c]];
      if(c === undefined)
        return [[a, b, a * b]];
    },
    '_ squared is _': function (a, b) {
      if(a === undefined && b === undefined)
        throw new Error('_ squared is _ - does not accept two unknows.');
      if(a === undefined)
        return [[Math.sqrt(b), b]];
      if(b === undefined)
        return [[a, a * a]];
      if(Math.abs(a * a - Math.abs(b)) < .0000001)
        return [[a, b]];
      else
        return [];
    },
    '_ > _': function (a, b) {
      if(a > b)
        return [[a, b]];
      else
        return [];
    },
    '_ >= _': function (a, b) {
      if(a >= b)
        return [[a, b]];
      else
        return [];
    },
    '_ < _': function (a, b) {
      if(a < b)
        return [[a, b]];
      else
        return [];
    },
    '_ <= _': function (a, b) {
      if(a <= b)
        return [[a, b]];
      else
        return [];
    },
    '_ mod _ = _': function (a, b, c) {
      return [[a, b, a % b]];
    },
    'cos _ = _': function (x, y) {
      return [[x, Math.cos(x / 180 * Math.PI)]];
    },
    'sin _ = _': function (x, y) {
      return [[x, Math.sin(x / 180 * Math.PI)]];
    },
    '_ is _ joined by _': function(output, inputs, delimiter) {
      // TODO strengthen against failure
      return [[inputs.join(delimiter), inputs, delimiter]];
    },
    '_ has _ items': function(list, length) {
      // TODO strengthen agaist failure
      return [[list, list.length]];
    },
    '_ is item _ of _': function(item, number, list) {
      if(number === undefined)
        return list.map((x, i) => [x, i+1, list]);
      return [[list[number-1], number, list]];
    },
  }, {
    'background color of _ is _': function (card, color) {
      const cardElement = cardDict[card];
      cardElement.style.backgroundColor = color;
      cardBackgroundColors[card] = color;
    },
    'line is drawn from _ _ to _ _': function (x1, y1, x2, y2) {
      ctx.strokeStyle = magicColor;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    'circle is drawn at _ _ with radius _': function (x, y, r) {
      ctx.strokeStyle = magicColor;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.stroke();
    },
    '_ is displayed at _ _': function(text, x, y) {
      ctx.fillStyle = magicColor;
      ctx.textBaseline = 'hanging';
      ctx.font = '14px Arial';
      const lines = text.split('\n');
      for(let i = 0; i < lines.length; i++)
        ctx.fillText(lines[i], x, y + i * 16);
    },
  });
  // result is intentionally ignored for now

  document.body.querySelectorAll('.card').forEach(card =>
    card.style.backgroundColor = card.id in cardBackgroundColors
      ? cardBackgroundColors[card.id]
      : 'white'
  );
}, INTERVAL_MS);



// Utils

function intersects(x, y, card) {
  const cardElement = cardDict[card];
  const left = cardElement.offsetLeft;
  if(x < left) return false;
  const top = cardElement.offsetTop;
  if(y < top) return false;
  const right = left + cardElement.clientWidth;
  if(x > right) return false;
  const bottom = top + cardElement.clientHeight;
  if(y > bottom) return false;
  return true;
}

// Setup canvas
const canvas = document.getElementById('magic-canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ctx = canvas.getContext('2d');
ctx.globalAlpha = .5;
function resetCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
const magicColor = 'blue';
