<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AcademicCouncil;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Exceptions\DriverException;
use Intervention\Image\ImageManager;

class AcademicCouncilController extends Controller
{
    public function index()
    {
        $councils = AcademicCouncil::orderBy('order', 'asc')
            ->orderBy('created_at', 'desc')
            ->paginate(10);
        return response()->json($councils);
    }

    private const IMAGE_DIMENSIONS = [
        'small' => ['width' => 150, 'height' => 150],
        'medium' => ['width' => 300, 'height' => 300],
        'large' => ['width' => 600, 'height' => 600],
    ];

    /**
     * @return array{width:int,height:int}
     */
    private function resolveTargetDimensions(string $imageSize, ?int $customWidth, ?int $customHeight): array
    {
        $sizeKey = array_key_exists($imageSize, self::IMAGE_DIMENSIONS) ? $imageSize : 'medium';

        return [
            'width' => $customWidth ?? self::IMAGE_DIMENSIONS[$sizeKey]['width'],
            'height' => $customHeight ?? self::IMAGE_DIMENSIONS[$sizeKey]['height'],
        ];
    }

    /**
     * @return array{image:string,image_size:string,image_width:int|null,image_height:int|null}
     */
    private function processImageUpload(UploadedFile $image, string $imageSize, int $targetWidth, int $targetHeight): array
    {
        $path = $image->store('academic-council', 'public');
        $fullPath = storage_path('app/public/' . $path);

        if (extension_loaded('gd')) {
            try {
                (new ImageManager(new Driver()))
                    ->read($fullPath)
                    ->scaleDown($targetWidth, $targetHeight)
                    ->save();
            } catch (DriverException $exception) {
                Log::warning('GD driver failed to resize Academic Council image: ' . $exception->getMessage());
            } catch (\Throwable $exception) {
                Log::warning('Unexpected error while resizing Academic Council image: ' . $exception->getMessage());
            }
        } else {
            Log::warning('GD extension is not available; skipping Academic Council image resizing.');
        }

        $dimensions = @getimagesize($fullPath);

        return [
            'image' => $path,
            'image_size' => $imageSize,
            'image_width' => $dimensions ? (int) $dimensions[0] : null,
            'image_height' => $dimensions ? (int) $dimensions[1] : null,
        ];
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:255',
            'position' => 'required|string|max:255',
            'email' => 'nullable|email|max:255',
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

        $validated = $validator->validated();

        $councilData = [
            'name' => $validated['name'],
            'position' => $validated['position'],
            'designation' => $validated['designation'] ?? null,
            'bio' => $validated['bio'] ?? null,
            'qualifications' => $validated['qualifications'] ?? null,
            'department' => $validated['department'] ?? null,
            'order' => $validated['order'] ?? 0,
            'is_active' => $validated['is_active'] ?? true,
        ];

        $hasEmailColumn = Schema::hasColumn('academic_councils', 'email');
        if ($hasEmailColumn) {
            $councilData['email'] = $validated['email'] ?? $this->generatePlaceholderEmail($validated['name']);
        }

        // Handle image upload
        if ($request->hasFile('image')) {
            $image = $request->file('image');
            $imageSize = $validated['image_size'] ?? 'medium';

            $dimensions = $this->resolveTargetDimensions(
                $imageSize,
                $validated['image_width'] ?? null,
                $validated['image_height'] ?? null
            );
            $imageDetails = $this->processImageUpload($image, $imageSize, $dimensions['width'], $dimensions['height']);

            $councilData = array_merge($councilData, $imageDetails);
        }

        try {
            $council = AcademicCouncil::create($councilData);
        } catch (QueryException $exception) {
            if ($hasEmailColumn && str_contains($exception->getMessage(), 'academic_councils.email')) {
                $councilData['email'] = $this->generatePlaceholderEmail($validated['name']);
                $council = AcademicCouncil::create($councilData);
            } else {
                throw $exception;
            }
        }

        return response()->json([
            'message' => 'Academic Council member created successfully',
            'council' => $council
        ], 201);
    }

    public function show(string $id)
    {
        $council = AcademicCouncil::findOrFail($id);
        return response()->json($council);
    }

    public function update(Request $request, string $id)
    {
        $council = AcademicCouncil::findOrFail($id);
        
        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|string|max:255',
            'position' => 'sometimes|string|max:255',
            'designation' => 'nullable|string|max:255',
            'bio' => 'nullable|string',
            'qualifications' => 'nullable|string',
            'image' => 'nullable|string|max:500',
            'image_size' => 'nullable|string|in:small,medium,large',
            'image_width' => 'nullable|integer|min:50|max:2000',
            'image_height' => 'nullable|integer|min:50|max:2000',
            'department' => 'nullable|string|max:255',
            'order' => 'sometimes|integer|min:0',
            'is_active' => 'sometimes|boolean',
        ]);

        if ($validator->fails()) {
            throw new ValidationException($validator);
        }

        $council->update($validator->validated());

        return response()->json([
            'message' => 'Academic Council member updated successfully',
            'council' => $council
        ]);
    }

    public function uploadImage(Request $request, string $id)
    {
        $council = AcademicCouncil::findOrFail($id);
        
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
            $validated = $validator->validated();
            $imageSize = $validated['image_size'] ?? 'medium';

            $dimensions = $this->resolveTargetDimensions(
                $imageSize,
                $validated['image_width'] ?? null,
                $validated['image_height'] ?? null
            );

            if ($council->image) {
                Storage::disk('public')->delete($council->image);
            }

            $imageDetails = $this->processImageUpload($image, $imageSize, $dimensions['width'], $dimensions['height']);

            $council->update($imageDetails);

            return response()->json([
                'message' => 'Image uploaded successfully',
                'image' => $imageDetails['image'],
            ]);
        }

        return response()->json(['message' => 'No image uploaded'], 400);
    }

    public function destroy(string $id)
    {
        $council = AcademicCouncil::findOrFail($id);
        $council->delete();

        return response()->json(['message' => 'Academic Council member deleted successfully']);
    }

    public function publicList()
    {
        $councils = AcademicCouncil::where('is_active', true)
            ->orderBy('order', 'asc')
            ->get();

        return response()->json($councils);
    }

    private function generatePlaceholderEmail(string $name): string
    {
        $slug = Str::slug($name);

        if (blank($slug)) {
            $slug = 'member';
        }

        return sprintf('%s-%s@placeholder.local', $slug, Str::lower(Str::random(10)));
    }
}
