import React from 'react';
export default function Controls({ ws }){
const sendCtrl = (action) => {
if (!ws || ws.readyState !== WebSocket.OPEN) return;
ws.send(JSON.stringify({ kind: 'control', action }));
};
return (
<div>
<button className="btn" onClick={()=>sendCtrl('pause')}>Pause</button>
<button className="btn" onClick={()=>sendCtrl('resume')}>Resume</button>
<button className="btn" onClick={()=>sendCtrl('step')}>Step</button>
</div>
);
}
