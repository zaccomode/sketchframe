# Sketchframe: A Sketch Details Exporter

_Sketchframe_ is a neat little toolkit to export (and then view) `.sketchframe` files, which are a custom filetype that contains both a visual image of a given frame, and a detailed JSON structure of the containing Sketch design. Sketchframes contain design information like colours, relative positions, design tokens, etc., and can include free-text annotations to help developers understand your work.

Sketchframes are especially useful for folks who utilise AI in their work, as this allows you to hand your agents rich, detailed information about your designs, rather than having them pixel-peep a flat image.

## The Sketch Plugin

To create a Sketchframe, you'll need to install the Sketch plugin.

To export a frame as a `.sketchframe`, use Plugins > Sketchframe > Export Selected Frame..., then select the destination folder.

If you don't have the Sketchframe application (see below), `.sketchframe` files will appear as folders on your system, which can be opened and navigated like a zip archive.

## The Sketchframe App

To view a `.sketchframe` file, you'll need to install the Sketchframe macOS application. This gives you a dedicated viewing app and a Quick Look Finder extension.

The Sketchframe application also contains a surface for you to annotate your designs, allowing you to provide explanations or additional details that are best kept alongside your design.

## Working with AI

Sketchframe files can be easily read by any AI agent. Every `.sketchframe` file comes bundled with instructions for how to read the file.
