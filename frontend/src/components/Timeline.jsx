import React from 'react';
export default function Timeline({ events }){
return (
<div>
{events.map((e,i) => <div key={i} className="small">{e.type} {e.payload && JSON.stringify(e.payload).slice(0,80)}</div>)}
</div>
);
}
