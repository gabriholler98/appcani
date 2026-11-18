const radians=Math.PI/180;
const earthRadius=6371000;

function boundary(area) {
  const latitude=area.lat*radians;
  const longitude=area.lon*radians;
  const arc=area.radius*1000/earthRadius;
  return Array.from({length:128},(_,index)=>{
    const bearing=index*2*Math.PI/128;
    const lat=Math.asin(Math.sin(latitude)*Math.cos(arc)+Math.cos(latitude)*Math.sin(arc)*Math.cos(bearing));
    const lon=longitude+Math.atan2(Math.sin(bearing)*Math.sin(arc)*Math.cos(latitude),Math.cos(arc)-Math.sin(latitude)*Math.sin(lat));
    return [lat/radians,lon/radians];
  });
}

export function setupSearchArea(map,L) {
  const pane=map.createPane("searchAreaPane");
  pane.style.zIndex="350";
  pane.style.pointerEvents="none";
  let mask,center,area;
  function draw() {
    if(!area)return;
    const visible=map.getBounds().pad(1);
    const outer=[
      [visible.getSouth(),visible.getWest()],[visible.getNorth(),visible.getWest()],
      [visible.getNorth(),visible.getEast()],[visible.getSouth(),visible.getEast()],
    ];
    const rings=[outer,boundary(area)];
    if(mask)mask.setLatLngs(rings);
    else mask=L.polygon(rings,{
      pane:"searchAreaPane",stroke:false,fill:true,fillRule:"evenodd",fillOpacity:1,
      interactive:false,className:"search-area-mask",
    }).addTo(map);
  }
  map.on("moveend",draw);
  return {
    update(next) {
      area=next;
      if(!area) {
        mask?.remove();center?.remove();
        mask=center=undefined;
        return;
      }
      draw();
      const point=[area.lat,area.lon];
      if(center)center.setLatLng(point);
      else center=L.circleMarker(point,{
        pane:"searchAreaPane",radius:4,color:"#ffffff",weight:2,fillColor:"#075b43",fillOpacity:1,interactive:false,
      }).addTo(map);
    },
    fit() {
      if(area)map.fitBounds(L.latLngBounds(boundary(area)),{padding:[28,28],maxZoom:15});
    },
  };
}
