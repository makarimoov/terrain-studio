// Интерактивный выбор области на карте (Leaflet).
// Клик по карте или перетаскивание маркера обновляют поля координат,
// «Охват» рисуется рамкой вокруг центра.

export function createAreaPicker({ latEl, lonEl, spanEl, zoom = 13 }) {
  const el = document.getElementById('areaMap');
  if (!el) return { invalidate() {}, getCenter() { return null; } };
  if (typeof L === 'undefined') {
    el.innerHTML = '<p class="hint">Карта недоступна (Leaflet не загрузился) — вводите координаты вручную.</p>';
    return { invalidate() {}, getCenter() { return null; } };
  }

  const readCenter = () => L.latLng(parseFloat(latEl.value) || 0, parseFloat(lonEl.value) || 0);
  const readSpan = () => Math.max(0.0005, parseFloat(spanEl.value) || 0.02);

  const map = L.map(el).setView(readCenter(), zoom);
  // Спутниковая подложка Esri (без ключа). CARTO dark требует API-ключ,
  // поэтому не используем его — см. водяной знак "API KEY REQUIRED".
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution:
      'Tiles &copy; <a href="https://www.esri.com">Esri</a> — данные: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  }).addTo(map);

  const icon = L.divIcon({
    className: 'area-marker',
    html: '<div class="area-marker-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  const marker = L.marker(readCenter(), { draggable: true, icon }).addTo(map);
  let rect = null;

  function drawRect() {
    const c = readCenter();
    const s = readSpan() / 2;
    const bounds = [
      [c.lat - s, c.lng - s],
      [c.lat + s, c.lng + s],
    ];
    if (rect) rect.setBounds(bounds);
    else {
      rect = L.rectangle(bounds, {
        color: '#4fd1c5',
        weight: 2,
        fillColor: '#4fd1c5',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(map);
    }
  }

  function syncFrom(latlng) {
    latEl.value = latlng.lat.toFixed(6);
    lonEl.value = latlng.lng.toFixed(6);
    marker.setLatLng(latlng);
    drawRect();
  }

  map.on('click', (e) => syncFrom(e.latlng));
  marker.on('dragend', () => syncFrom(marker.getLatLng()));

  [latEl, lonEl].forEach((input) =>
    input.addEventListener('change', () => {
      const c = readCenter();
      marker.setLatLng(c);
      drawRect();
    })
  );
  spanEl.addEventListener('change', drawRect);

  drawRect();

  return {
    invalidate() {
      map.invalidateSize();
    },
    getCenter() {
      return readCenter();
    },
  };
}