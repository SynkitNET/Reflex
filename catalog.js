(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReflexCatalog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const list = [];

  const menuPaths = {
    'layer.group': [['Layer', 'Group Layers']],
    'layer.smart': [['Layer', 'Smart Objects', 'Convert to Smart Object']],
    'layer.rasterize': [['Layer', 'Rasterize', 'Layer']],
    'layer.clip': [['Layer', 'Create Clipping Mask']],
    'layer.unclip': [['Layer', 'Release Clipping Mask']],
    'selection.all': [['Select', 'All']],
    'selection.deselect': [['Select', 'Deselect']],
    'selection.inverse': [['Select', 'Inverse']],
    'selection.subject': [['Select', 'Subject']],
    'selection.reselect': [['Select', 'Reselect']],
    'view.fit': [['View', 'Fit on Screen']],
    'view.actual': [['View', '100%']],
    'filter.gaussian': [['Filter', 'Blur', 'Gaussian Blur']],
    'filter.motion': [['Filter', 'Blur', 'Motion Blur']],
    'filter.noise': [['Filter', 'Noise', 'Add Noise']],
    'filter.highpass': [['Filter', 'Other', 'High Pass']],
    'adjust.curves': [['Image', 'Adjustments', 'Curves']],
    'adjust.levels': [['Image', 'Adjustments', 'Levels']],
    'adjust.hue': [['Image', 'Adjustments', 'Hue/Saturation']],
    'adjust.invert': [['Image', 'Adjustments', 'Invert']]
  };
  function add(id, title, category, icon, requires, operation, aliases, interactive) {
    const group = { layer: 'Layers', selection: 'Selection', edit: 'Edit', history: 'History', view: 'View', filter: 'Filters', adjust: 'Adjustments', reflex: 'Easter eggs' }[id.split('.')[0]];
    list.push({ id, title, category, icon, requires, operation, menuPaths: menuPaths[id] || [], aliases: (aliases || '').split('|').concat(category === 'Tools' ? ['tool'] : []), interactive: !!interactive, kind: 'command', subtitle: category === 'Tools' ? 'Select tool' : group || 'Photoshop' });
  }
  add('layer.new', 'New layer', 'Commands', 'layer-new', 'document', 'newLayer', 'create|empty|blank');
  add('layer.duplicate', 'Duplicate layer', 'Commands', 'copy', 'layer', 'duplicateLayer', 'copy|clone');
  add('layer.group', 'Group selected layers', 'Commands', 'folder', 'layer', 'groupLayersEvent', 'folder|organize');
  add('layer.smart', 'Convert to Smart Object', 'Commands', 'cube', 'layer', 'newPlacedLayer', 'smart object|nondestructive');
  add('layer.rasterize', 'Rasterize layer', 'Commands', 'raster', 'layer', 'rasterizeLayer', 'pixels|raster');
  add('layer.merge', 'Merge selected layers', 'Commands', 'merge', 'layer', 'mergeLayersNew', 'combine|merge down');
  add('layer.mask', 'Add layer mask', 'Commands', 'mask', 'layer', 'addMask', 'reveal all|mask');
  add('layer.clip', 'Create clipping mask', 'Commands', 'clip', 'layer', 'groupEvent', 'clip|clipping');
  add('layer.unclip', 'Release clipping mask', 'Commands', 'unclip', 'layer', 'ungroupEvent', 'unclip');
  add('layer.visibility', 'Toggle layer visibility', 'Commands', 'eye', 'layer', 'toggleVisibility', 'show|hide');
  add('layer.lock', 'Toggle layer lock', 'Commands', 'lock', 'layer', 'toggleLock', 'unlock|protect');
  add('layer.delete', 'Delete', 'Commands', 'trash', 'layer', 'deleteLayers', 'delete layers|remove selected layers|trash');
  add('edit.fill', 'Fill', 'Commands', 'fill', 'layer', 'fill', 'fill foreground|foreground color|colour');
  add('selection.all', 'Select all', 'Commands', 'select-all', 'document', 'selectAll', 'selection|entire');
  add('selection.deselect', 'Deselect', 'Commands', 'deselect', 'document', 'deselect', 'selection none|clear selection');
  add('selection.inverse', 'Invert selection', 'Commands', 'inverse', 'document', 'inverse', 'inverse|opposite');
  add('selection.subject', 'Select subject', 'Commands', 'subject', 'document', 'autoCutout', 'automatic|subject|cutout');
  add('selection.reselect', 'Reselect', 'Commands', 'reselect', 'document', 'reselect', 'previous selection');
  add('history.undo', 'Undo', 'Commands', 'undo', 'document', 'undo', 'back|revert');
  add('history.redo', 'Redo', 'Commands', 'redo', 'document', 'redo', 'forward');
  add('view.fit', 'Fit on screen', 'Commands', 'fit', 'document', 'fitOnScreen', 'zoom fit|canvas');
  add('view.actual', 'Actual pixels', 'Commands', 'pixels', 'document', 'actualPixels', 'zoom 100|one hundred');
  add('filter.gaussian', 'Gaussian blur', 'Commands', 'blur', 'layer', 'gaussianBlur', 'blur|soften', true);
  add('filter.motion', 'Motion blur', 'Commands', 'motion', 'layer', 'motionBlur', 'blur|movement', true);
  add('filter.noise', 'Add noise', 'Commands', 'noise', 'layer', 'addNoise', 'grain|texture', true);
  add('filter.highpass', 'High pass', 'Commands', 'highpass', 'layer', 'highPass', 'sharpen|detail', true);
  add('adjust.curves', 'Curves', 'Commands', 'curve', 'layer', 'curves', 'contrast|color|tone', true);
  add('adjust.levels', 'Levels', 'Commands', 'levels', 'layer', 'levels', 'contrast|black point|white point', true);
  add('adjust.hue', 'Hue / Saturation', 'Commands', 'hue', 'layer', 'hueSaturation', 'color|colour|saturation', true);
  add('adjust.invert', 'Invert colors', 'Commands', 'contrast', 'layer', 'invert', 'negative|colour');
  [
    ['move', 'Move', 'moveTool', 'move', 'position|transform'], ['brush', 'Brush', 'paintbrushTool', 'brush', 'paint|draw'],
    ['eraser', 'Eraser', 'eraserTool', 'eraser', 'erase|remove'], ['pen', 'Pen', 'penTool', 'pen', 'path|bezier'],
    ['text', 'Type', 'typeCreateOrEditTool', 'type', 'text|font|typography'], ['crop', 'Crop', 'cropTool', 'crop', 'trim'],
    ['eyedropper', 'Eyedropper', 'eyedropperTool', 'dropper', 'sample|color picker'], ['hand', 'Hand', 'handTool', 'hand', 'pan'],
    ['zoom', 'Zoom', 'zoomTool', 'search', 'magnify'], ['lasso', 'Lasso', 'lassoTool', 'lasso', 'freehand select'],
    ['marquee', 'Rectangular marquee', 'marqueeRectTool', 'selection', 'rectangle|selection'],
    ['gradient', 'Gradient', 'gradientTool', 'gradient', 'blend|fade'], ['clone', 'Clone stamp', 'cloneStampTool', 'stamp', 'retouch'],
    ['healing', 'Spot healing brush', 'spotHealingBrushTool', 'healing', 'retouch|blemish'],
    ['quick', 'Quick selection', 'quickSelectTool', 'quick-select', 'select|automatic'],
    ['object', 'Object selection', 'magicLassoTool', 'object-select', 'select|object'],
    ['artboard', 'Artboard', 'artboardTool', 'crop', 'canvas|board'],
    ['ellipse-marquee', 'Elliptical marquee', 'marqueeEllipTool', 'selection', 'circle|oval|selection'],
    ['row-marquee', 'Single row marquee', 'marqueeSingleRowTool', 'selection', 'horizontal|selection'],
    ['column-marquee', 'Single column marquee', 'marqueeSingleColumnTool', 'selection', 'vertical|selection'],
    ['polygon-lasso', 'Polygonal lasso', 'polySelTool', 'lasso', 'polygon|straight|selection'],
    ['magnetic-lasso', 'Magnetic lasso', 'magneticLassoTool', 'lasso', 'edge|selection'],
    ['wand', 'Magic wand', 'magicWandTool', 'quick-select', 'color|colour|selection'],
    ['perspective-crop', 'Perspective crop', 'perspectiveCropTool', 'crop', 'straighten|perspective'],
    ['frame', 'Frame', 'framedGroupTool', 'crop', 'placeholder|image'],
    ['slice', 'Slice', 'sliceTool', 'crop', 'web|export'],
    ['slice-select', 'Slice select', 'sliceSelectTool', 'move', 'web|slice selection'],
    ['sampler', 'Color sampler', 'colorSamplerTool', 'dropper', 'colour|sample|measure'],
    ['ruler', 'Ruler', 'rulerTool', 'transform', 'measure|distance|angle'],
    ['note', 'Note', 'textAnnotTool', 'type', 'annotation|comment'],
    ['count', 'Count', 'countTool', 'pixels', 'counting|measurement'],
    ['remove', 'Remove', 'removeTool', 'healing', 'retouch|cleanup|object removal'],
    ['healing-brush', 'Healing brush', 'magicStampTool', 'healing', 'retouch|sample|blemish'],
    ['patch', 'Patch', 'patchSelection', 'healing', 'retouch|repair'],
    ['content-move', 'Content-aware move', 'recomposeSelection', 'move', 'content aware|recompose'],
    ['red-eye', 'Red eye', 'redEyeTool', 'eye', 'retouch|pupil'],
    ['pencil', 'Pencil', 'pencilTool', 'brush', 'draw|hard edge|pixel'],
    ['color-replace', 'Color replacement', 'colorReplacementBrushTool', 'brush', 'colour|recolor|recolour'],
    ['mixer', 'Mixer brush', 'wetBrushTool', 'brush', 'wet|mix|paint'],
    ['pattern-stamp', 'Pattern stamp', 'patternStampTool', 'stamp', 'texture|paint'],
    ['history-brush', 'History brush', 'historyBrushTool', 'brush', 'restore|history'],
    ['art-history', 'Art history brush', 'artBrushTool', 'brush', 'stylize|paint'],
    ['background-eraser', 'Background eraser', 'backgroundEraserTool', 'eraser', 'erase|cutout'],
    ['magic-eraser', 'Magic eraser', 'magicEraserTool', 'eraser', 'erase|color|colour'],
    ['bucket', 'Paint bucket', 'bucketTool', 'fill', 'fill|paint'],
    ['blur', 'Blur tool', 'blurTool', 'blur', 'soften|retouch'],
    ['sharpen', 'Sharpen tool', 'sharpenTool', 'highpass', 'detail|retouch'],
    ['smudge', 'Smudge', 'smudgeTool', 'brush', 'blend|smear'],
    ['dodge', 'Dodge', 'dodgeTool', 'hue', 'lighten|exposure'],
    ['burn', 'Burn', 'burnInTool', 'hue', 'darken|exposure'],
    ['sponge', 'Sponge', 'saturationTool', 'hue', 'saturation|desaturate'],
    ['freeform-pen', 'Freeform pen', 'freeformPenTool', 'pen', 'freehand|path'],
    ['curvature-pen', 'Curvature pen', 'curvaturePenTool', 'pen', 'curve|path'],
    ['anchor-add', 'Add anchor point', 'addKnotTool', 'pen', 'path|node|pen'],
    ['anchor-delete', 'Delete anchor point', 'deleteKnotTool', 'pen', 'path|node|pen'],
    ['anchor-convert', 'Convert point', 'convertKnotTool', 'pen', 'anchor|path|handle|pen'],
    ['path-select', 'Path selection', 'pathComponentSelectTool', 'move', 'path|black arrow'],
    ['direct-select', 'Direct selection', 'directSelectTool', 'move', 'anchor|white arrow'],
    ['vertical-type', 'Vertical type', 'typeVerticalCreateOrEditTool', 'type', 'text|font|typography'],
    ['type-mask', 'Horizontal type mask', 'typeCreateMaskTool', 'type', 'text|selection'],
    ['vertical-type-mask', 'Vertical type mask', 'typeVerticalCreateMaskTool', 'type', 'text|selection'],
    ['rectangle', 'Rectangle', 'rectangleTool', 'selection', 'shape|vector'],
    ['ellipse', 'Ellipse', 'ellipseTool', 'selection', 'shape|circle|oval|vector'],
    ['polygon', 'Polygon', 'polygonTool', 'pen', 'shape|vector'],
    ['line', 'Line', 'lineTool', 'pen', 'shape|vector'],
    ['custom-shape', 'Custom shape', 'customShapeTool', 'pen', 'shape|vector'],
    ['triangle', 'Triangle', 'triangleTool', 'pen', 'shape|vector'],
    ['rounded-rectangle', 'Rounded rectangle', 'roundedRectangleTool', 'selection', 'shape|vector|round corners'],
    ['adjustment-brush', 'Adjustment brush', 'adjustmentBrushTool', 'brush', 'local adjustment|paint|exposure'],
    ['rotate', 'Rotate view', 'rotateTool', 'hand', 'rotate canvas|rotation']
  ].forEach(([id, title, op, icon, aliases]) => add('tool.' + id, title, 'Tools', icon, null, 'tool:' + op, aliases));
  add('reflex.missing-ping', 'Missing ping', 'Commands', 'missing-ping', null, 'missingPing', 'enemy missing|question mark|ping spam|league|lol|easter egg|mia');
  return list;
});
