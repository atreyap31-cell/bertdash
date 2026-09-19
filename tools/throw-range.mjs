// How far a charged throw actually carries, which is what makes an air
// delivery possible. The reachability analyser uses this number.
import { installGlobals, makeCanvas, advance, resetClock } from '../tests/harness.mjs';
installGlobals();
const { Game } = await import('../js/engine/game.js');
const { PHYSICS } = await import('../js/data/config.js');

const down = c => globalThis.dispatchWindow('keydown', { code: c, repeat: false, preventDefault(){} });
const up = c => globalThis.dispatchWindow('keyup', { code: c });

function range(aim, { run = 0, charge = PHYSICS.throwChargeFrames } = {}) {
  resetClock();
  const game = new Game(makeCanvas({ record: false }), {
    id:'r', title:'R', width:12000, height:2000, background:'#000', theme:'horizontal',
    physics:{}, vehicles:[], powerups:[],
    startPos:{x:200,y:800}, foodPos:{x:240,y:800}, goalPos:{x:11900,y:1950},
    platforms:[{x:0,y:900,width:1200,height:200,type:'static'}],
  }, { skin:{color:'#0c6',textColor:'#fff'}, onWin(){}, onLose(){}, onStats(){} });
  game.start();
  advance(40);
  if (run) { down('KeyD'); advance(run); up('KeyD'); while (Math.abs(game.player.vx) > 0.2) advance(1); }

  const from = game.player.x;
  aim.forEach(down);
  advance(charge);
  aim.forEach(up);
  advance(1);

  let reach = 0;
  const launchY = game.food.y;
  for (let i = 0; i < 600; i++) {
    advance(1);
    reach = Math.max(reach, game.food.x - from);
    if (game.food.y > launchY + 40 && game.food.vy > 0) break;  // back to launch height
    if (game.deathReason) break;
  }
  game.destroy();
  return Math.round(reach);
}

console.log('charged throw range (px), measured at launch height\n');
console.log('  standing, 45 deg      ', range(['ArrowUp','ArrowRight']));
console.log('  running, 45 deg       ', range(['ArrowUp','ArrowRight'], { run: 70 }));
console.log('  standing, flat        ', range(['ArrowRight']));
console.log('  running, flat         ', range(['ArrowRight'], { run: 70 }));
console.log('  uncharged, 45 deg     ', range(['ArrowUp','ArrowRight'], { charge: 1 }));
