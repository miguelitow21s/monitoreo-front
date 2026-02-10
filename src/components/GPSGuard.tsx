import React, { useEffect, useState } from 'react';

interface GPSGuardProps {
  onLocation: (coords: { lat: number; lng: number }) => void;
  geofence: { lat: number; lng: number; radius: number };
}

const GPSGuard: React.FC<GPSGuardProps> = ({ onLocation, geofence }) => {
  const [error, setError] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [inside, setInside] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('GPS no disponible');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setCoords({ lat, lng });
        onLocation({ lat, lng });
        const dist = Math.sqrt(
          Math.pow(lat - geofence.lat, 2) + Math.pow(lng - geofence.lng, 2)
        );
        setInside(dist <= geofence.radius);
      },
      () => setError('No se pudo obtener ubicación'),
      { enableHighAccuracy: true }
    );
  }, [geofence, onLocation]);

  if (error) return <div className="text-red-500">{error}</div>;
  if (!coords) return <div className="text-gray-500">Obteniendo ubicación...</div>;
  if (!inside) return <div className="text-red-600">Fuera del área permitida</div>;

  return <div className="text-green-600">Ubicación validada</div>;
};

export default GPSGuard;
