import { installGlobals, makeCanvas, advance, resetClock } from './tests/harness.mjs';
installGlobals();
const { Game } = await import('./js/engine/game.js');
// A lift that carries the player up into a solid ceiling.
const level = { id:'t',title:'T',width:1600,height:1400,background:'#101010',theme:'horizontal',
  startPos:{x:500,y:1052}, goalPos:{x:1500,y:1070}, foodPos:{x:540,y:1052}, physics:{}, vehicles:[], powerups:[], hints:[],
  platforms:[
    {x:0,y:1100,width:1600,height:200,type:'static'},
    {x:400,y:400,width:700,height:120,type:'static'},          // ceiling
    {x:440,y:1060,width:300,height:30,type:'moving',velY:-6,range:600},
  ] };
resetClock();
const g=new Game(makeCanvas({record:false}),level,{skin:{color:'#06c167',textColor:'#fff'},onWin(){},onLose(){},onStats(){}});
g.start();
let worst=0;
for(let i=0;i<200;i++){
  advance(1);
  const p=g.player, c=g.level.platforms[1];
  if (p.x < c.x+c.width && p.x+p.width > c.x && p.y < c.y+c.height && p.y+p.height > c.y) {
    worst=Math.max(worst, Math.min((p.y+p.height)-c.y,(c.y+c.height)-p.y));
  }
}
console.log('deepest the rider was pushed into the ceiling:', worst.toFixed(1)+'px');
g.destroy();
