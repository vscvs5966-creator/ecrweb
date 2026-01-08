<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Management;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Intervention\Image\ImageManager;
use Intervention\Image\Drivers\Gd\Driver;

class ManagementController extends Controller
{
    public function index()
    {
        $management = Management::orderBy('order', 'asc')
            ->orderBy('created_at', 'desc')
            ->paginate(10);
        return response()->json($management);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'position' => 'required|string|max:255',
            'designation' => 'nullable|string|max:255',
            'bio' => 'nullable|string',
            'qualifications' => 'nullable|string',
            'image' => 'nullable|image|mimes:jpeg,png,jpg,gif|max:2048',
            'image_size' => 'nullable|string|in:small,medium,large',
            'image_width' => 'nullable|integer|min:50|max:2000',
            'image_height' => 'nullable|integer|min:50|max:2000',
            'department' => 'nullable|string|max:255',
            'order' => 'integer|min:0',
            'is_active' => 'boolean',
        ]);

        if ($validator->fails()) {
            throw new ValidationException($validator);
        }

        $managementData = [
            'name' => $request->name,
            'position' => $request->position,
            'designation' => $request->designation,
            'bio' => $request->bio,
            'qualifications' => $request->qualifications,
            'department' => $request->department,
            'order' => $request->order ?? 0,
            'is_active' => $request->is_active ?? true,
        ];

        // Handle image upload
        if ($request->hasFile('image')) {
            $image = $request->file('image');
            $imageSize = $request->image_size ?? 'medium';
            
            // Define size dimensions
            $dimensions = [
                'small' => ['width' => 150, 'height' => 150],
                'medium' => ['width' => 300, 'height' => 300],
                'large' => ['width' => 600, 'height' => 600],
            ];
            
            $targetWidth = $request->image_width ?? $dimensions[$imageSize]['width'];
            $targetHeight = $request->image_height ?? $dimensions[$imageSize]['height'];
            
            // Process image
            $path = $image->store('management', 'public');
            
            // Resize image if needed
            $fullPath = storage_path('app/public/' . $path);
            (new ImageManager(new Driver()))
                ->read($fullPath)
                ->scaleDown($targetWidth, $targetHeight)
                ->save();
                
            $managementData['image'] = $path;
            $managementData['image_size'] = $imageSize;
            $managementData['image_width'] = $targetWidth;
            $managementData['image_height'] = $targetHeight;
        }

        $management = Management::create($managementData);

        return response()->json([
            'message' => 'Management member created successfully',
            'management' => $management
        ], 201);
    }

    public function show(string $id)
    {
        $management = Management::findOrFail($id);
        return response()->json($management);
    }

    public function update(Request $request, string $id)
    {
        $management = Management::findOrFail($id);
        
        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|string|max:255',
            'position' => 'sometimes|string|max:255',
            'designation' => 'nullable|string|max:255',
            'bio' => 'nullable|string',
            'image' => 'nullable|string|max:500',
            'department' => 'nullable|string|max:255',
            'order' => 'sometimes|integer|min:0',
            'is_active' => 'sometimes|boolean',
        ]);

        if ($validator->fails()) {
            throw new ValidationException($validator);
        }

        $management->update($request->all());

        return response()->json([
            'message' => 'Management member updated successfully',
            'management' => $management
        ]);
    }

    public function uploadImage(Request $request, string $id)
    {
        $management = Management::findOrFail($id);
        
        $validator = Validator::make($request->all(), [
            'image' => 'required|image|mimes:jpeg,png,jpg,gif|max:2048',
            'image_size' => 'nullable|string|in:small,medium,large',
            'image_width' => 'nullable|integer|min:50|max:2000',
            'image_height' => 'nullable|integer|min:50|max:2000',
        ]);

        if ($validator->fails()) {
            throw new ValidationException($validator);
        }

        if ($request->hasFile('image')) {
            $image = $request->file('image');
            $imageSize = $request->image_size ?? 'medium';
            
            // Define size dimensions
            $dimensions = [
                'small' => ['width' => 150, 'height' => 150],
                'medium' => ['width' => 300, 'height' => 300],
                'large' => ['width' => 600, 'height' => 600],
            ];
            
            $targetWidth = $request->image_width ?? $dimensions[$imageSize]['width'];
            $targetHeight = $request->image_height ?? $dimensions[$imageSize]['height'];
            
            // Delete old image
            if ($management->image) {
                Storage::disk('public')->delete($management->image);
            }
            
            // Process new image
            $path = $image->store('management', 'public');
            
            // Resize image if needed
            $fullPath = storage_path('app/public/' . $path);
            (new ImageManager(new Driver()))
                ->read($fullPath)
                ->scaleDown($targetWidth, $targetHeight)
                ->save();
                
            $management->update([
                'image' => $path,
                'image_size' => $imageSize,
                'image_width' => $targetWidth,
                'image_height' => $targetHeight,
            ]);

            return response()->json([
                'message' => 'Image uploaded successfully',
                'image' => $path
            ]);
        }

        return response()->json(['message' => 'No image uploaded'], 400);
    }

    public function destroy(string $id)
    {
        $management = Management::findOrFail($id);
        $management->delete();

        return response()->json(['message' => 'Management member deleted successfully']);
    }

    public function publicList()
    {
        $management = Management::where('is_active', true)
            ->orderBy('order', 'asc')
            ->get();

        return response()->json($management);
    }
}
