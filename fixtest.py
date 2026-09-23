import io

p = 'tests/engine.test.mjs'
s = io.open(p, encoding='utf-8').read()

start = s.index("test('a moving platform cannot pass through a player standing still'")
s = s[:start] + '''test('a player left inside a solid is pushed back out of it', () => {
  // The collision pass resolves a landing when you are falling and a head bump
  // when you are rising. At exactly zero vertical speed it did neither, so an
  // overlap could simply persist — and vy is exactly zero the whole time you
  // stand on the ground holding an aim key, which is when a lift moving into
  // you would otherwise be ignored.
  const { game } = boot(fixture({
    height: 1200,
    startPos: { x: 500, y: 852 }, foodPos: { x: 540, y: 852 },
    platforms: [
      { x: 0, y: 900, width: 3000, height: 200, type: 'static' },
      { x: 460, y: 600, width: 200, height: 40, type: 'static' },
    ],
  }));
  advance(20);

  // Put the player inside the shelf with no vertical speed at all: exactly the
  // state the old code had no branch for.
  const shelf = game.level.platforms[1];
  game.player.y = shelf.y - 10;
  game.player.vy = 0;
  advance(1);

  const p = game.player;
  const inside = p.y < shelf.y + shelf.height && p.y + p.height > shelf.y;
  const depth = inside ? Math.min((p.y + p.height) - shelf.y, (shelf.y + shelf.height) - p.y) : 0;
  game.destroy();

  assert.ok(depth <= 12,
    `the player was left ${depth.toFixed(0)}px inside a solid with no way out`);
});
'''
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('test replaced')
