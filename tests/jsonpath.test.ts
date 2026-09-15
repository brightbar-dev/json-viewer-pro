import { describe, it, expect } from 'vitest';
import { compileJsonPath, looksLikeJsonPath } from '../lib/jsonpath';
import { LosslessNumber } from '../lib/lossless';

const store = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 399 },
  },
  'full name': 'x',
  "it's": 1,
};

function paths(query: string, doc: unknown = store, limit?: number) {
  const c = compileJsonPath(query);
  if (!c.ok) throw new Error(`${c.error.message} @${c.error.offset}`);
  return c.run(doc, limit).paths;
}
function error(query: string) {
  const c = compileJsonPath(query);
  if (c.ok) throw new Error('expected an error');
  return c.error;
}

describe('JSONPath: basics', () => {
  it('$ is the document', () => expect(paths('$')).toEqual([[]]));
  it('dot member', () => expect(paths('$.store.bicycle.color')).toEqual([['store', 'bicycle', 'color']]));
  it('bracket member, both quote styles', () => {
    expect(paths("$['store']['bicycle']")).toEqual([['store', 'bicycle']]);
    expect(paths('$["full name"]')).toEqual([['full name']]);
    expect(paths("$['it\\'s']")).toEqual([["it's"]]);
  });
  it('a missing member matches nothing', () => expect(paths('$.nope.deeper')).toEqual([]));
  it('index and negative index', () => {
    expect(paths('$.store.book[0].title')).toEqual([['store', 'book', 0, 'title']]);
    expect(paths('$.store.book[-1].title')).toEqual([['store', 'book', 3, 'title']]);
    expect(paths('$.store.book[9]')).toEqual([]);
  });
  it('wildcards over arrays and objects', () => {
    expect(paths('$.store.book[*].author')).toHaveLength(4);
    expect(paths('$.store.*')).toEqual([['store', 'book'], ['store', 'bicycle']]);
  });
  it('slices', () => {
    expect(paths('$.store.book[0:2]').map((p) => p[2])).toEqual([0, 1]);
    expect(paths('$.store.book[-2:]').map((p) => p[2])).toEqual([2, 3]);
    expect(paths('$.store.book[:3:2]').map((p) => p[2])).toEqual([0, 2]);
    expect(paths('$.store.book[::-1]').map((p) => p[2])).toEqual([3, 2, 1, 0]);
  });
  it('unions', () => {
    expect(paths('$.store.book[0,2].title').map((p) => p[2])).toEqual([0, 2]);
    expect(paths("$.store.bicycle['color','price']")).toEqual([['store', 'bicycle', 'color'], ['store', 'bicycle', 'price']]);
  });
  it('whitespace is tolerated around brackets', () => expect(paths(" $.store [ 'bicycle' ] ")).toEqual([['store', 'bicycle']]));
});

describe('JSONPath: recursive descent', () => {
  it('..key finds every depth, in document order', () => {
    expect(paths('$..price')).toEqual([
      ['store', 'book', 0, 'price'],
      ['store', 'book', 1, 'price'],
      ['store', 'book', 2, 'price'],
      ['store', 'book', 3, 'price'],
      ['store', 'bicycle', 'price'],
    ]);
  });
  it('..[index]', () => expect(paths('$..book[2].author')).toEqual([['store', 'book', 2, 'author']]));
  // 3 top-level values + book, bicycle + 4 books + 18 book fields + 2 bicycle fields
  it('..* reaches every value below the root', () => expect(paths('$..*')).toHaveLength(29));
  it('stops at the match limit and says so', () => {
    const c = compileJsonPath('$..*');
    if (!c.ok) throw new Error();
    const r = c.run(store, 5);
    expect(r.paths).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });
});

describe('JSONPath: filters', () => {
  it('numeric comparison', () => expect(paths('$.store.book[?(@.price < 10)].title').map((p) => p[2])).toEqual([0, 2]));
  it('RFC 9535 style without parentheses', () => expect(paths('$.store.book[?@.price >= 12.99]').map((p) => p[2])).toEqual([1, 3]));
  it('string equality with either quote', () => {
    expect(paths("$.store.book[?(@.category == 'reference')]")).toEqual([['store', 'book', 0]]);
    expect(paths('$.store.book[?(@.category != "fiction")]')).toEqual([['store', 'book', 0]]);
  });
  it('existence', () => expect(paths('$.store.book[?(@.isbn)]').map((p) => p[2])).toEqual([2, 3]));
  it('&&, || and !', () => {
    expect(paths("$.store.book[?(@.category == 'fiction' && @.price < 10)]").map((p) => p[2])).toEqual([2]);
    expect(paths('$.store.book[?(@.price < 9 || @.price > 20)]').map((p) => p[2])).toEqual([0, 2, 3]);
    expect(paths('$.store.book[?(!@.isbn)]').map((p) => p[2])).toEqual([0, 1]);
    expect(paths('$.store.book[?(!(@.price > 9) && @.isbn)]').map((p) => p[2])).toEqual([2]);
  });
  it('comparing with a $ path', () => expect(paths('$.store.book[?(@.price < $.store.bicycle.price)]')).toHaveLength(4));
  it('filters apply to object members too', () => expect(paths("$.store[?(@.color == 'red')]")).toEqual([['store', 'bicycle']]));
  it('filter under recursive descent', () => expect(paths('$..[?(@.price > 100)]')).toEqual([['store', 'bicycle']]));
  it('type mismatches are false, not errors', () => {
    expect(paths("$.store.book[?(@.price == '8.95')]")).toEqual([]);
    expect(paths("$.store.book[?(@.price < 'z')]")).toEqual([]);
  });
  it('booleans and null', () => {
    const doc = { items: [{ on: true }, { on: false }, { on: null }, {}] };
    expect(paths('$.items[?(@.on == true)]', doc)).toEqual([['items', 0]]);
    expect(paths('$.items[?(@.on == null)]', doc)).toEqual([['items', 2]]);
    expect(paths('$.items[?(@.on != null)]', doc).map((p) => p[1])).toEqual([0, 1, 3]);
  });
  it('big integers compare exactly', () => {
    const doc = { users: [{ id: new LosslessNumber('149883901923910003') }, { id: new LosslessNumber('149883901923910004') }, { id: 7 }] };
    expect(paths('$.users[?(@.id == 149883901923910003)]', doc)).toEqual([['users', 0]]);
    expect(paths('$.users[?(@.id > 149883901923910003)]', doc)).toEqual([['users', 1]]);
    expect(paths('$.users[?(@.id < 10)]', doc)).toEqual([['users', 2]]);
  });
});

describe('JSONPath: errors are positioned and never executed', () => {
  it('must start with $', () => expect(error('store.book')).toMatchObject({ offset: 0 }));
  it('unclosed bracket', () => expect(error('$.store[0').message).toMatch(/Expected ']'/));
  it('unterminated string', () => expect(error("$['abc")).toMatchObject({ message: 'Unterminated string', offset: 2 }));
  it('bad member name', () => expect(error('$.9abc').message).toMatch(/member name/));
  it('zero slice step', () => expect(error('$[::0]').message).toMatch(/step/));
  it('a literal alone is not a condition', () => expect(error('$[?(1)]').message).toMatch(/not a condition/));
  it('descendant in a filter is refused', () => expect(error('$[?(@..x == 1)]').message).toMatch(/not allowed/));
  it('code is never evaluated', () => {
    expect(compileJsonPath("$[?(@.constructor.constructor('return 1')())]").ok).toBe(false);
    expect(paths('$.constructor', {})).toEqual([]);
    expect(paths('$.__proto__', {})).toEqual([]);
  });
});

describe('looksLikeJsonPath', () => {
  it('JSONPath', () => expect(['$', '$.a', '$[0]', '  $..x', '$ .a'].map(looksLikeJsonPath)).toEqual([true, true, true, true, true]));
  it('plain text', () => expect(['price', '$100', 'a$.b', ''].map(looksLikeJsonPath)).toEqual([false, false, false, false]));
});
