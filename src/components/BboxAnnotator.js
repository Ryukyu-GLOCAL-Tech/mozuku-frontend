import React, { useState, useRef, useEffect } from 'react';

export default function BboxAnnotator({ imageUrl, detections, onSave, onCancel }) {
  const canvasRef = useRef(null);
  const [bboxes, setBboxes] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [currentBox, setCurrentBox] = useState(null);
  const [selectedBboxIndex, setSelectedBboxIndex] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  // Convert detections to bbox format on mount
  useEffect(() => {
    if (detections && detections.length > 0) {
      const converted = detections.map((det, idx) => ({
        id: idx,
        bbox: det.bbox || [],
        label: det.label || 'impurity',
        confidence: det.confidence || 0,
        status: 'original' // 'original', 'kept', 'deleted', 'added'
      }));
      setBboxes(converted);
    }
  }, [detections]);

  // Load image first
  useEffect(() => {
    if (!imageUrl) return;
    
    console.log('🖼️ BboxAnnotator loading image:', imageUrl);
    console.log('  Detections count:', detections?.length || 0);
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      console.log('✅ Image loaded successfully:', img.width, 'x', img.height);
      setImageDimensions({ width: img.width, height: img.height });
      setImageLoaded(true);
    };
    
    img.onerror = () => {
      console.error('❌ Failed to load image:', imageUrl);
    };
    
    img.src = imageUrl;
  }, [imageUrl, detections]);

  // Draw bboxes on canvas
  useEffect(() => {
    if (!imageLoaded || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Draw image
      ctx.drawImage(img, 0, 0);
      
      // Draw all bboxes
      bboxes.forEach((box, idx) => {
        if (box.status === 'deleted') return;
        
        const [x1, y1, x2, y2] = box.bbox;
        const width = x2 - x1;
        const height = y2 - y1;
        
        // Set color based on status
        let color = '#3b82f6'; // blue for original
        if (box.status === 'kept') color = '#10b981'; // green
        if (box.status === 'added') color = '#f59e0b'; // orange
        
        ctx.strokeStyle = idx === selectedBboxIndex ? '#ef4444' : color; // red if selected
        ctx.lineWidth = idx === selectedBboxIndex ? 3 : 2;
        ctx.strokeRect(x1, y1, width, height);
        
        // Draw label
        ctx.fillStyle = color;
        ctx.fillRect(x1, y1 - 20, 100, 20);
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(`${box.label} ${(box.confidence * 100).toFixed(0)}%`, x1 + 5, y1 - 5);
      });
      
      // Draw current drawing box
      if (currentBox) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          currentBox.x,
          currentBox.y,
          currentBox.width,
          currentBox.height
        );
      }
    };
    
    img.src = imageUrl;
  }, [imageLoaded, bboxes, currentBox, selectedBboxIndex, imageUrl]);

  const handleMouseDown = (e) => {
    if (!editMode) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Scale to actual image coordinates
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const actualX = x * scaleX;
    const actualY = y * scaleY;
    
    // Check if clicked on existing bbox
    const clickedIndex = bboxes.findIndex(box => {
      if (box.status === 'deleted') return false;
      const [x1, y1, x2, y2] = box.bbox;
      return actualX >= x1 && actualX <= x2 && actualY >= y1 && actualY <= y2;
    });
    
    if (clickedIndex >= 0) {
      setSelectedBboxIndex(clickedIndex);
    } else {
      // Start drawing new box
      setDrawing(true);
      setStartPoint({ x: actualX, y: actualY });
      setSelectedBboxIndex(null);
    }
  };

  const handleMouseMove = (e) => {
    if (!drawing || !startPoint) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const actualX = x * scaleX;
    const actualY = y * scaleY;
    
    setCurrentBox({
      x: Math.min(startPoint.x, actualX),
      y: Math.min(startPoint.y, actualY),
      width: Math.abs(actualX - startPoint.x),
      height: Math.abs(actualY - startPoint.y)
    });
  };

  const handleMouseUp = (e) => {
    if (!drawing || !currentBox) return;
    
    // Add new bbox
    if (currentBox.width > 10 && currentBox.height > 10) {
      const newBox = {
        id: Date.now(),
        bbox: [
          currentBox.x,
          currentBox.y,
          currentBox.x + currentBox.width,
          currentBox.y + currentBox.height
        ],
        label: 'impurity',
        confidence: 1.0,
        status: 'added'
      };
      setBboxes([...bboxes, newBox]);
    }
    
    setDrawing(false);
    setStartPoint(null);
    setCurrentBox(null);
  };

  const handleKeepBbox = (index) => {
    const updated = [...bboxes];
    updated[index].status = 'kept';
    setBboxes(updated);
    setSelectedBboxIndex(null);
  };

  const handleDeleteBbox = (index) => {
    const updated = [...bboxes];
    updated[index].status = 'deleted';
    setBboxes(updated);
    setSelectedBboxIndex(null);
  };

  const handleSaveLabels = () => {
    const corrections = {
      kept: [],
      deleted: [],
      added: []
    };
    
    bboxes.forEach((box, idx) => {
      if (box.status === 'kept' || (box.status === 'original' && selectedBboxIndex !== idx)) {
        // Keep original index
        if (box.status === 'original' || box.status === 'kept') {
          corrections.kept.push(box.id);
        }
      } else if (box.status === 'deleted') {
        corrections.deleted.push(box.id);
      } else if (box.status === 'added') {
        // Convert to YOLO format (normalized)
        const [x1, y1, x2, y2] = box.bbox;
        const x_center = (x1 + x2) / 2 / imageDimensions.width;
        const y_center = (y1 + y2) / 2 / imageDimensions.height;
        const width = (x2 - x1) / imageDimensions.width;
        const height = (y2 - y1) / imageDimensions.height;
        
        corrections.added.push({
          class: 0, // impurity class
          x: x_center,
          y: y_center,
          w: width,
          h: height
        });
      }
    });
    
    onSave(corrections);
  };

  return (
    <div style={{ marginTop: '20px' }}>
      {/* Edit Mode Toggle */}
      <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button
          onClick={() => setEditMode(!editMode)}
          style={{
            padding: '8px 16px',
            backgroundColor: editMode ? '#ef4444' : '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: '600'
          }}
        >
          {editMode ? '✏️ Edit Mode: ON' : '👁️ View Mode'}
        </button>
        
        {editMode && (
          <span style={{ color: '#94a3b8', fontSize: '13px' }}>
            Click boxes to select, drag to draw new boxes
          </span>
        )}
      </div>

      {/* Canvas */}
      <div style={{
        backgroundColor: '#0f172a',
        borderRadius: '8px',
        padding: '10px',
        marginBottom: '15px',
        position: 'relative'
      }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onLoad={() => setImageLoaded(true)}
          style={{
            maxWidth: '100%',
            cursor: editMode ? 'crosshair' : 'default',
            borderRadius: '4px'
          }}
        />
      </div>

      {/* Bbox List */}
      <div style={{ marginBottom: '15px' }}>
        <h4 style={{ marginTop: 0, marginBottom: '10px', fontSize: '14px' }}>
          Detections ({bboxes.filter(b => b.status !== 'deleted').length})
        </h4>
        <div style={{ display: 'grid', gap: '8px' }}>
          {bboxes.map((box, idx) => box.status !== 'deleted' && (
            <div
              key={box.id}
              onClick={() => setSelectedBboxIndex(idx)}
              style={{
                padding: '10px',
                backgroundColor: idx === selectedBboxIndex ? '#1e293b' : '#0f172a',
                borderRadius: '4px',
                border: idx === selectedBboxIndex ? '2px solid #3b82f6' : '1px solid #334155',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div style={{ flex: 1 }}>
                <span style={{ 
                  fontWeight: 'bold',
                  color: box.status === 'kept' ? '#10b981' : box.status === 'added' ? '#f59e0b' : '#3b82f6'
                }}>
                  #{idx + 1}
                </span>
                <span style={{ marginLeft: '10px', fontSize: '13px', color: '#94a3b8' }}>
                  {box.label} ({(box.confidence * 100).toFixed(0)}%)
                </span>
                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#64748b' }}>
                  {box.status === 'added' ? '(New)' : box.status === 'kept' ? '(Verified)' : ''}
                </span>
              </div>
              
              {editMode && idx === selectedBboxIndex && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  {box.status !== 'kept' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleKeepBbox(idx); }}
                      style={{
                        padding: '4px 12px',
                        backgroundColor: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      ✅ Keep
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteBbox(idx); }}
                    style={{
                      padding: '4px 12px',
                      backgroundColor: '#ef4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    ❌ Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '10px 20px',
            backgroundColor: '#334155',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSaveLabels}
          style={{
            padding: '10px 20px',
            backgroundColor: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: '600'
          }}
        >
          💾 Save Labels
        </button>
      </div>
    </div>
  );
}
