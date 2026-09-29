/* glm5.3-flash authoring set — 48 technique demos, written fresh in this session.
   Same shared engine contract as index.html (poses are limb TARGETS, elbows/knees
   solved by IK), but every pose, cue and phase verb here is this session's own
   reckoning of the movement. home = shortened muscle, away = lengthened. */
module.exports = {

/* ---------- CHEST ---------- */
'bench':{setup:'Eyes under the bar, shoulder blades pinched, feet driving into the floor.',label:'Barbell Bench Press',view:'side',scene:'benchFlat',load:'bar',
 ph:['DESCEND','PRESS UP'],pole:{elb:90,knee:-90},toe:0,
 home:{hip:[128,136],torso:180,head:174,wr:[94,95],an:[136,182]},
 away:{hip:[128,136],torso:180,head:174,wr:[86,118],an:[136,182]}},

'db-bench':{setup:'Sit with the bells on your thighs, kick them back as you lie flat.',label:'Dumbbell Bench Press',view:'side',scene:'benchFlat',load:'db',
 ph:['LOWER','PRESS'],pole:{elb:90,knee:-90},toe:0,
 home:{hip:[128,136],torso:180,head:174,wrN:[93,94],wrF:[88,97],an:[136,182]},
 away:{hip:[128,136],torso:180,head:174,wrN:[84,120],wrF:[79,122],an:[136,182]}},

'incline-db':{setup:'Bench at 30 degrees, feet planted, bells delivered over the elbows.',label:'Incline Dumbbell Press',view:'side',scene:'benchIncline',load:'db',
 ph:['LOWER','PRESS'],pole:{elb:90,knee:-90},toe:0,
 home:{hip:[116,150],torso:-120,head:-130,wrN:[92,80],wrF:[87,83],an:[142,180]},
 away:{hip:[116,150],torso:-120,head:-130,wrN:[88,126],wrF:[83,128],an:[142,180]}},

'machine-press':{setup:'Seat height puts the handles at mid-chest; head and back on the pad.',label:'Machine Chest Press',view:'side',scene:'machinePress',load:'handle',
 ph:['RETURN','PRESS'],pole:{elb:90,knee:0},toe:0,
 home:{hip:[112,141],torso:-100,head:-95,wr:[146,103],an:[134,180]},
 away:{hip:[112,141],torso:-100,head:-95,wr:[122,118],an:[134,180]}},

'cable-fly':{setup:'Pulleys at chest height, one foot back, soft fixed elbows, lean in a touch.',label:'Cable Chest Fly',view:'front',scene:'cableDual',load:'handle',
 ph:['OPEN','SQUEEZE'],pole:{elb:90,knee:90},toe:10,
 home:{hip:[100,119],torso:-90,head:-90,wrN:[95,118],wrF:[105,118],anN:[92,180],anF:[108,180]},
 away:{hip:[100,119],torso:-90,head:-90,wrN:[60,96],wrF:[140,96],anN:[92,180],anF:[108,180]}},

'pecdec':{setup:'Seat so the handles level with the shoulders, arms barely bent.',label:'Machine Chest Fly',view:'front',scene:'pecDec',load:'handle',
 ph:['OPEN','SQUEEZE'],pole:{elb:90,knee:90},toe:10,
 home:{hip:[100,140],torso:-90,head:-90,wrN:[94,112],wrF:[106,112],anN:[90,180],anF:[110,180]},
 away:{hip:[100,140],torso:-90,head:-90,wrN:[62,100],wrF:[138,100],anN:[90,180],anF:[110,180]}},

'pushup':{setup:'Hands just outside the ribs, screw them into the floor, squeeze the glutes.',label:'Push-Up',view:'side',scene:'floor',load:null,
 ph:['DESCEND','PRESS UP'],pole:{elb:0,knee:0},toe:15,
 home:{hip:[120,140],torso:-178,head:178,wr:[84,181],an:[150,179]},
 away:{hip:[120,155],torso:-178,head:178,wr:[84,181],an:[150,179]}},

'dip':{setup:'Grip the bars, shrug down, hang with a small forward lean before rep one.',label:'Dip',view:'side',scene:'dipBars',load:null,
 ph:['DESCEND','PRESS UP'],pole:{elb:-10,knee:105},toe:20,
 home:{hip:[120,150],torso:-100,head:-95,wr:[112,156],an:[142,166]},
 away:{hip:[120,164],torso:-110,head:-105,wr:[112,156],an:[142,166]}},

/* ---------- BACK ---------- */
'row':{setup:'Shins vertical, hinge to 45 degrees, bar hanging under the shoulders.',label:'Barbell Row',view:'side',scene:'floor',load:'bar',
 ph:['LOWER','ROW'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[108,119],torso:-135,head:-160,wr:[86,108],an:[122,178]},
 away:{hip:[108,119],torso:-135,head:-160,wr:[80,136],an:[122,178]}},

'db-row':{setup:'Left hand and knee on the bench, square the hips, let the bell hang long.',label:'Dumbbell Row',view:'side',scene:'benchRow',load:'db1',
 ph:['LOWER','ROW'],pole:{elb:0,knee:-25},poleF:{knee:180},toe:0,
 home:{hip:[126,128],torso:-171,head:-178,wr:[96,120],wrF:[98,144],anN:[136,152],anF:[150,180]},
 away:{hip:[126,128],torso:-171,head:-178,wr:[102,164],wrF:[98,144],anN:[136,152],anF:[150,180]}},

'machine-row':{setup:'Chest tall against the pad, grab the handles, arms fully out first.',label:'Machine Row',view:'side',scene:'machineRow',load:'handle',
 ph:['REACH','PULL'],pole:{elb:75,knee:-30},toe:0,
 home:{hip:[116,140],torso:-90,head:-90,wr:[130,110],an:[140,179]},
 away:{hip:[116,140],torso:-90,head:-90,wr:[156,106],an:[140,179]}},

'cablerow':{setup:'Sit tall, feet on the platform, take the handle with a long straight back.',label:'Seated Cable Row',view:'side',scene:'cableLow',load:'handle',
 ph:['REACH','PULL'],pole:{elb:75,knee:-45},toe:0,
 home:{hip:[106,138],torso:-85,head:-88,wr:[84,120],an:[150,178]},
 away:{hip:[106,138],torso:-115,head:-120,wr:[58,108],an:[150,178]}},

'pulldown':{setup:'Thighs snug under the pads, hands a thumb outside the shoulders.',label:'Lat Pulldown',view:'side',scene:'cableHigh',load:'pullbar',
 ph:['RISE','PULL'],pole:{elb:90,knee:-90},toe:0,
 home:{hip:[112,138],torso:-100,head:-105,wr:[100,112],an:[140,179]},
 away:{hip:[112,138],torso:-88,head:-90,wr:[106,60],an:[140,179]}},

'pullup':{setup:'Overhand grip just outside the shoulders, start from a dead hang.',label:'Pull-Up',view:'side',scene:'pullupBar',load:null,
 ph:['LOWER','PULL'],pole:{elb:0,knee:160},toe:20,
 home:{hip:[104,120],torso:-85,head:-90,wr:[110,51],an:[126,152]},
 away:{hip:[110,129.4],torso:-90,head:-90,wr:[110,51],an:[126,152]}},

'chinup':{setup:'Underhand grip at shoulder width, hang tall, legs still.',label:'Chin-Up',view:'side',scene:'pullupBar',load:null,
 ph:['LOWER','PULL'],pole:{elb:0,knee:160},toe:20,
 home:{hip:[104,119],torso:-82,head:-86,wr:[110,51],an:[126,152]},
 away:{hip:[110,129.4],torso:-90,head:-90,wr:[110,51],an:[126,152]}},

'facepull':{setup:'Rope at eye height, step back to tension, thumbs pointing back.',label:'Face Pull',view:'side',scene:'cableFace',load:null,
 ph:['REACH','PULL'],pole:{elb:300,knee:180},toe:0,
 home:{hip:[102,119],torso:-90,head:-90,wr:[88,76],anN:[113,179],anF:[110,177]},
 away:{hip:[102,119],torso:-90,head:-90,wr:[140,80],anN:[113,179],anF:[110,177]}},

'aus-row':{setup:'Bar at hip height, heels planted, body one plank line under it.',label:'Inverted Row',view:'side',scene:'lowBar',load:null,
 ph:['LOWER','ROW'],pole:{elb:0,knee:0},toe:0,
 home:{hip:[114.9,135.7],torso:-133.5,head:-148,wr:[100,120],an:[158,181]},
 away:{hip:[99.9,157.5],torso:-158,head:-172,wr:[100,120],an:[158,181]}},

/* ---------- SHOULDERS ---------- */
'ohp':{setup:'Bar on the front delts, elbows just ahead of it, glutes squeezed.',label:'Overhead Press',view:'side',scene:'floor',load:'bar',
 ph:['LOWER','PRESS'],pole:{elb:215,knee:180},toe:0,
 home:{hip:[104,118],torso:-90,head:-90,wr:[100,40],an:[113,179]},
 away:{hip:[104,118],torso:-90,head:-90,wr:[96,92],an:[113,179]}},

'db-ohp':{setup:'Seated tall against the pad, bells at ear height, elbows under them.',label:'Dumbbell Shoulder Press',view:'side',scene:'benchUpright',load:'db',
 ph:['LOWER','PRESS'],pole:{elb:215,knee:-25},toe:0,
 home:{hip:[118,136],torso:-95,head:-95,wr:[110,58],an:[140,180]},
 away:{hip:[118,136],torso:-95,head:-95,wr:[104,94],an:[140,180]}},

'machine-ohp':{setup:'Seat set so the handles start level with the top of the shoulders.',label:'Machine Shoulder Press',view:'side',scene:'machineOHP',load:'handle',
 ph:['LOWER','PRESS'],pole:{elb:215,knee:-25},toe:0,
 home:{hip:[116,138],torso:-95,head:-95,wr:[114,60],an:[142,180]},
 away:{hip:[116,138],torso:-95,head:-95,wr:[122,97],an:[142,180]}},

'lateral':{setup:'A pair of light bells at the sides, palms in, small bend fixed in the elbows.',label:'Lateral Raise',view:'front',scene:'floor',load:'db',
 ph:['LOWER','RAISE'],pole:{elb:90,knee:90},toe:10,
 home:{hip:[100,119],torso:-90,head:-90,wrN:[58,84],wrF:[142,84],anN:[90,180],anF:[110,180]},
 away:{hip:[100,119],torso:-90,head:-90,wrN:[88,124],wrF:[112,124],anN:[90,180],anF:[110,180]}},

'pike-pushup':{setup:'Walk the feet in until the hips stack over the shoulders, hands under the face.',label:'Pike Push-Up',view:'side',scene:'floor',load:null,
 ph:['DESCEND','PRESS UP'],pole:{elb:0,knee:0},toe:10,
 home:{hip:[127,116],torso:140,head:155,wr:[100,181],an:[134,176]},
 away:{hip:[123.5,132.5],torso:135,head:150,wr:[100,181],an:[134,176]}},

/* ---------- ARMS ---------- */
'curl':{setup:'Shoulder-width underhand grip, elbows touching the ribs the whole set.',label:'Barbell Curl',view:'side',scene:'floor',load:'bar',
 ph:['EXTEND','CURL'],pole:{elb:45,knee:180},toe:0,
 home:{hip:[102,119],torso:-90,head:-90,wr:[86,97],an:[113,179]},
 away:{hip:[102,119],torso:-90,head:-90,wr:[98,124],an:[113,179]}},

'hammer':{setup:'Bells held vertically like hammers, thumbs up, elbows glued to the sides.',label:'Hammer Curl',view:'side',scene:'floor',load:'db',
 ph:['EXTEND','CURL'],pole:{elb:45,knee:180},toe:0,
 home:{hip:[102,119],torso:-90,head:-90,wr:[87,98],an:[113,179]},
 away:{hip:[102,119],torso:-90,head:-90,wr:[99,125],an:[113,179]}},

'cable-curl':{setup:'Low pulley, step back until the cable pulls taut, elbows pinned.',label:'Cable Curl',view:'side',scene:'cableLow',load:'bar',
 ph:['EXTEND','CURL'],pole:{elb:45,knee:180},toe:0,
 home:{hip:[102,119],torso:-90,head:-90,wr:[87,99],an:[113,179]},
 away:{hip:[102,119],torso:-90,head:-90,wr:[84,116],an:[113,179]}},

'preacher':{setup:'Armpits over the top of the pad, upper arms flat on it, elbows level.',label:'Preacher Curl',view:'side',scene:'preacher',load:'bar',
 ph:['EXTEND','CURL'],pole:{elb:315,knee:180},toe:0,
 home:{hip:[128,152],torso:-105,head:-110,wr:[98,104],an:[140,181]},
 away:{hip:[128,152],torso:-105,head:-110,wr:[94,142],an:[140,181]}},

'pushdown':{setup:'High pulley, elbows locked to the ribs, cable taut before the first rep.',label:'Triceps Pushdown',view:'side',scene:'cableHigh',load:'handle',
 ph:['RETURN','PRESS DOWN'],pole:{elb:45,knee:180},toe:0,
 home:{hip:[102,119],torso:-90,head:-90,wr:[114,124],an:[113,179]},
 away:{hip:[102,119],torso:-96,head:-92,wr:[122,98],an:[113,179]}},

'skull':{setup:'Lie flat, bar held over the shoulders, elbows pointing at the ceiling.',label:'Skullcrusher',view:'side',scene:'benchFlat',load:'bar',
 ph:['LOWER','EXTEND'],pole:{elb:315,knee:-90},toe:0,
 home:{hip:[128,136],torso:180,head:174,wr:[88,95],an:[136,182]},
 away:{hip:[128,136],torso:180,head:174,wr:[76,120],an:[136,182]}},

'db-ext':{setup:'One bell in both hands overhead, elbows narrow, ribs down.',label:'Overhead Triceps Extension',view:'side',scene:'floor',load:'db1',
 ph:['LOWER','EXTEND'],pole:{elb:300,knee:180},toe:0,
 home:{hip:[102,119],torso:-90,head:-90,wr:[98,42],an:[113,179]},
 away:{hip:[102,119],torso:-90,head:-90,wr:[84,74],an:[113,179]}},

/* ---------- LEGS ---------- */
'squat':{setup:'Bar on the upper traps, hands pulling it into the back, feet screwed out.',label:'Back Squat',view:'side',scene:'rack',load:'bar',
 ph:['DESCEND','DRIVE'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[102,118],torso:-90,head:-90,wr:[95,89],an:[112,179]},
 away:{hip:[100,144],torso:-108,head:-125,wr:[82,116],an:[112,179]}},

'hack':{setup:'Shoulders and back flat on the pads, feet high and shoulder-width on the plate.',label:'Hack Squat',view:'side',scene:'hackSled',load:null,
 ph:['DESCEND','DRIVE'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[100,112],torso:-115,head:-125,wr:[82,86],an:[126,156]},
 away:{hip:[104,132],torso:-118,head:-128,wr:[84,107],an:[126,156]}},

'deadlift':{setup:'Bar over the middle of the foot, shins one inch away, chest up before the pull.',label:'Conventional Deadlift',view:'side',scene:'floor',load:'bar',
 ph:['LOWER','PULL'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[110,118],torso:-95,head:-90,wr:[107,125],an:[117,180]},
 away:{hip:[122,122],torso:145,head:152,wr:[112,178],an:[117,180]}},

'rdl':{setup:'Stand tall, soft fixed knees, bar touching the thighs at the start.',label:'Romanian Deadlift',view:'side',scene:'floor',load:'bar',
 ph:['HINGE','STAND'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[108,118],torso:-92,head:-90,wr:[106,124],an:[122,178]},
 away:{hip:[118,116],torso:160,head:172,wr:[86,171],an:[122,178]}},

'hipthrust':{setup:'Shoulder blades on the bench edge, bar over the hip crease, feet flat.',label:'Hip Thrust',view:'side',scene:'benchShoulder',load:'bar',loadAt:'hip',
 ph:['LOWER','DRIVE'],pole:{elb:0,knee:-30},toe:0,
 home:{hip:[130.8,140.7],torso:165,head:150,wr:[124,129],an:[158,182]},
 away:{hip:[125.2,171.1],torso:-144,head:-155,wr:[119,160],an:[158,182]}},

'legpress':{setup:'Hips and back flat, feet shoulder-width, whole foot on the platform.',label:'Leg Press',view:'side',scene:'legPress',load:null,
 ph:['LOWER','PRESS'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[110,142],torso:-125,head:-135,wr:[116,144],an:[168,150]},
 away:{hip:[110,142],torso:-125,head:-135,wr:[116,144],an:[126,160]}},

'bulgarian':{setup:'Front shin vertical, rear laces down on the bench, torso tall.',label:'Bulgarian Split Squat',view:'side',scene:'benchBehind',load:'db',
 ph:['DESCEND','DRIVE'],pole:{elb:0,knee:180},poleF:{knee:-80},toe:0,
 home:{hip:[104,126],torso:-95,head:-100,wr:[100,132],anN:[114,179],anF:[66,142]},
 away:{hip:[102,150],torso:-100,head:-105,wr:[92,156],anN:[114,179],anF:[66,142]}},

'lunge':{setup:'Long step, both knees bent at 90 at the bottom, torso stacked.',label:'Walking Lunge',view:'side',scene:'floor',load:'db',
 ph:['DESCEND','DRIVE'],pole:{elb:0,knee:180},poleF:{knee:130},toe:0,toeF:20,
 home:{hip:[108,124],torso:-90,head:-90,wr:[106,130],anN:[106,180],anF:[146,172]},
 away:{hip:[106,146],torso:-88,head:-90,wr:[105,152],anN:[106,180],anF:[146,172]}},

'legcurl':{setup:'Pad hooked on the lower calf, hips glued down, knees past the bench edge.',label:'Lying Leg Curl',view:'side',scene:'legCurl',load:null,
 ph:['EXTEND','CURL'],pole:{elb:0,knee:-115},toe:0,
 home:{hip:[110,131],torso:180,head:184,wr:[64,138],anN:[130,118],anF:[134,122]},
 away:{hip:[110,131],torso:180,head:184,wr:[64,138],anN:[156,126],anF:[158,130]}},

'legext':{setup:'Knee joint in line with the machine pivot, shinpads on the lower shin.',label:'Leg Extension',view:'side',scene:'legExt',load:null,
 ph:['LOWER','EXTEND'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[112,140],torso:-95,head:-90,wr:[124,142],an:[166,148]},
 away:{hip:[112,140],torso:-95,head:-90,wr:[124,142],an:[128,166]}},

'calf':{setup:'Yoke square on the shoulders, balls of the feet on the block, knees straight.',label:'Standing Calf Raise',view:'side',scene:'calfMachine',load:null,
 ph:['LOWER','RAISE'],pole:{elb:0,knee:180},toe:35,
 home:{hip:[112,106],torso:-90,head:-90,wr:[104,74],anN:[118,164],anF:[116,162],toeN:35,toeF:35},
 away:{hip:[112,99],torso:-90,head:-90,wr:[104,67],anN:[118,157],anF:[116,155],toeN:75,toeF:75}},

'air-squat':{setup:'Feet shoulder-width, toes out a touch, arms forward as a counterweight.',label:'Bodyweight Squat',view:'side',scene:'floor',load:null,
 ph:['DESCEND','DRIVE'],pole:{elb:0,knee:180},toe:0,
 home:{hip:[102,118],torso:-90,head:-90,wr:[82,96],an:[112,179]},
 away:{hip:[100,144],torso:-106,head:-118,wr:[70,114],an:[112,179]}},

'bw-split':{setup:'Long split, back knee under the hip, weight over the front mid-foot.',label:'Bodyweight Split Squat',view:'side',scene:'floor',load:null,
 ph:['DESCEND','DRIVE'],pole:{elb:0,knee:180},poleF:{knee:130},toe:0,toeF:20,
 home:{hip:[106,124],torso:-92,head:-95,wr:[103,128],anN:[110,180],anF:[142,174]},
 away:{hip:[104,146],torso:-96,head:-100,wr:[98,150],anN:[110,180],anF:[142,174]}},

'bridge':{setup:'Feet flat close to the glutes, arms at the sides, ribs down before lifting.',label:'Glute Bridge',view:'side',scene:'floor',load:null,
 ph:['LOWER','DRIVE'],pole:{elb:0,knee:-50},toe:0,
 home:{hip:[106.4,147.9],torso:142,head:132,wr:[93,181],an:[134,181]},
 away:{hip:[112.1,171.8],torso:177,head:184,wr:[95,181],an:[134,181]}},

'bw-calf':{setup:'Ball of one foot on the step, heel free, fingertips on a rail for balance.',label:'Single-Leg Calf Raise',view:'side',scene:'stepEdge',load:null,
 ph:['LOWER','RAISE'],pole:{elb:0,knee:180},toe:35,
 home:{hip:[112,96],torso:-90,head:-90,wr:[104,100],anN:[118,154],anF:[108,158],toeN:35,toeF:-10},
 away:{hip:[112,89],torso:-90,head:-90,wr:[104,93],anN:[118,147],anF:[108,151],toeN:80,toeF:-10}},

/* ---------- CORE ---------- */
'plank':{setup:'Elbows under the shoulders, forearms flat, toes tucked, one line.',label:'Plank',view:'side',scene:'floor',load:null,
 ph:['SET','HOLD'],pole:{elb:0,knee:0},toe:10,
 home:{hip:[122,150],torso:-175,head:178,wr:[86,181],an:[150,179]},
 away:{hip:[122,150],torso:-172,head:176,wr:[86,181],an:[150,179]}},

'hlr':{setup:'Grip the bar overhead, shoulders pulled down, legs together and straight.',label:'Hanging Leg Raise',view:'side',scene:'pullupBar',load:null,
 ph:['LOWER','RAISE'],pole:{elb:0,knee:180},toe:180,
 home:{hip:[110,129.4],torso:-90,head:-90,wr:[110,51],anN:[48,129],anF:[50,131]},
 away:{hip:[110,129.4],torso:-90,head:-90,wr:[110,51],anN:[112,181],anF:[114,181]}},

'crunch':{setup:'Kneel facing away, rope held beside the ears, hips locked over the knees.',label:'Cable Crunch',view:'side',scene:'cableHigh',load:null,
 ph:['EXTEND','CRUNCH'],pole:{elb:90,knee:-30},toe:15,
 home:{hip:[112,146],torso:-150,head:-160,wr:[62,120],an:[132,181]},
 away:{hip:[112,146],torso:-100,head:-105,wr:[97,93],an:[132,181]}},

'situp':{setup:'Knees bent, feet hooked or held, fingertips resting by the temples.',label:'Sit-Up',view:'side',scene:'floor',load:null,
 ph:['LOWER','SIT UP'],pole:{elb:0,knee:-45},toe:0,
 home:{hip:[118,158],torso:-135,head:-145,wr:[76,120],an:[140,181]},
 away:{hip:[118,158],torso:-176,head:-180,wr:[64,150],an:[140,181]}}
};
