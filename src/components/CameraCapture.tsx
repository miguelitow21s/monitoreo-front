import React, { useRef, useState } from 'react';

interface CameraCaptureProps {
  onCapture: (image: string) => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setStreaming(true);
      }
    } catch {
      setError('No se pudo acceder a la cámara');
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        context.drawImage(videoRef.current, 0, 0, 320, 240);
        const image = canvasRef.current.toDataURL('image/png');
        onCapture(image);
      }
    }
  };

  return (
    <div className="flex flex-col items-center">
      {!streaming && (
        <button onClick={startCamera} className="bg-blue-600 text-white px-4 py-2 rounded mb-4">Iniciar cámara</button>
      )}
      {error && <div className="text-red-500 mb-2">{error}</div>}
      <video ref={videoRef} width={320} height={240} autoPlay className="mb-4" />
      <canvas ref={canvasRef} width={320} height={240} className="hidden" />
      {streaming && (
        <button onClick={capturePhoto} className="bg-green-600 text-white px-4 py-2 rounded">Capturar foto</button>
      )}
    </div>
  );
};

export default CameraCapture;
