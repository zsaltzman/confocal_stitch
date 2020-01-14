const path = require('path');
const im = require('imagemagick');
const fs = require('fs').promises;
const sep = path.sep;

const program = require('commander');
const xml2js = require('xml2js').parseStringPromise;

const cvcompare = require('./cv_overlap_reduce.js');

const convertedImgString = 'converted_img';

program
    .option('-i, --indir <path>', 'Input directory for images to stitch')
    .option('-o, --outdir <path>', 'Output directory for stitched images', '/mnt/c/Users/Zach/Desktop/' + convertedImgString);

program.parse(process.argv);

let processMetadata = async (indir) => {
    try {
        let dirContents = await fs.readdir(indir);

        if (dirContents.err) { console.log('An error occured while parsing directory', indir, dirContents.err); }

        let rawDirContents = [], logfiles = [];
        for (let item of dirContents) {
            let stat = await fs.stat(indir + sep + item);
            let metadataObj = {};

            let isDirectory = stat.isDirectory();
            let extension = item.split('.'); extension = extension[extension.length - 1];

            //split off index from name
            //folder name for images should be the second item from the end
            //index number for images should be the 3rd and 4th indices in the item name
            if (isDirectory) {
	            let splitItem = item.split('_');
	            let index = [splitItem[2], splitItem[3]].join('_');
	            let prefix = [splitItem[1], splitItem[2]].join('_');

	            //index is where in the mosaic the image lies, prefix is which mosaic the image belongs to
	            metadataObj.index = index;
	            metadataObj.prefix = prefix;

            }

            if (extension === 'log') {
            	logfiles.push(indir + sep + item);
            } else {
	            metadataObj.name = item, metadataObj.directory = isDirectory;
	            rawDirContents.push(metadataObj);
	        }

        }

        //correlate log file data to each image in the raw directory contents
        //specifically, find which row and col each image belongs to.
        for (let file of logfiles) {
        	try {

        		//read log file and parse the XML info JSON
        		let contents = await fs.readFile(file);
        		let jsonContents = await xml2js(contents);

        		let prefix = file.split('/');
        		prefix = prefix[prefix.length - 1].split('.')[0].split('_');
        		prefix = [ prefix[1], prefix[2] ].join('_');

        		let mosaic = rawDirContents.filter( (e) => { 
        			let name = e.name.split('_'); 
        			name = [ name[0], name[1], name[2] ].join('_'); 
        			return name.includes(prefix) && e.directory; 
        		});

        		let mosaicEntry = jsonContents.XYStage.Mosaic[0];

        		for (let item of mosaic) {

        			//this should produce only one result
        			let tileInfo = mosaicEntry.ImageInfo.filter( (e) => { 
        				let name = e.Filename[0].split('.')[0].split('_');
        				name = [ name[2], name[3] ].join('_'); 
        				return name.includes(item.index);
        			});

        			item.col = parseInt(tileInfo[0].Xno[0]);
        			item.row = parseInt(tileInfo[0].Yno[0]);
        		}
        	} catch(e) {
        		console.log('An error occured while parsing log files', e);
        	}

        }

        //create array of directories with metadata files as a parameter
        let directoriesArray = rawDirContents.filter((d) => { return d.directory; });
        for (let i = 0; i < directoriesArray.length; i++) {
            let item = directoriesArray[i];
            let name = item.name.split('.')[0];

            //return any file with a similar name (that isn't a directory)
            let statsFiles = rawDirContents.filter((d) => {
                return (d.name.includes(name) || name.includes(d.name)) &&
                    !d.directory;
            });

            //Drop entries that don't have metadata associated with them
            if (statsFiles.length === 0) {
                directoriesArray.splice(i, 1);
                i--;
            } else {
                //TODO: Handle case where there's more than one metadata file? Is this necessary?
                directoriesArray[i].metadataFile = statsFiles[0];
                let imageContents = await fs.readdir(indir + sep + directoriesArray[i].name);
                let tifs = imageContents.filter((d) => {
                    let split = d.split('.');
                    return split[split.length - 1].toLowerCase().includes('tif');
                });

                directoriesArray[i].tifs = tifs;
            }

        }

        return directoriesArray;
    } catch (e) {
        console.log('An error occured while parsing metadata', indir, e);
    }

};

let stackTifs = async (directories, inputPath, outputPath) => {

	//create the output directory if necessary
	await fs.mkdir(outputPath, { 'recursive' : true });

    //sanitize input path to be appended with an appropriate separator
    inputPath = inputPath.charAt(inputPath.length - 1) === sep ? inputPath : inputPath + sep;
    try {

    	//create array of promises to track when process is finished
    	let promiseArray = []
        for (let directory of directories) {
            let fullTifPaths = [];
            for (let tif of directory.tifs) {
                fullTifPaths.push(inputPath + directory.name + sep + tif);
            };

            let defaultOutPath = outputPath + sep + convertedImgString + '_' + directory.index + '.tif';
            let convertParams = fullTifPaths;
            convertParams.push('-combine', defaultOutPath);

            promiseArray.push(new Promise( (resolve, reject) => {
            	im.convert(convertParams,
	            (err, stdout) => {
	            	if (err) { 
	            		console.log('ERROR: convert with params', convertParams, 'did not finish\n', err); 
	            		reject();
	            	}
	            	else {
	            		resolve();
	            	}
	            });
            }));
        }

        console.log('Stacking done, now stitching');
        await Promise.all(promiseArray);
    } catch (e) {
        console.log('An error occured while stacking tiffs', e);
    }
};

let stitchTifs = async (processedDirectories, tifPath) => {

    //create the directory for the cropped tifs
    const croppedImagesDir = tifPath + path.sep + 'cropped_images';

	// organize tifs by index number, stitch them together left to right (1 farthest left, last one farthest right)
	let tifs = await fs.readdir(tifPath);
	let promiseArray = [];

	// finds the number of mosaics by looking for the maximum image index in the image set
	let numImages = tifs
	.filter( (e) => { return e.includes(convertedImgString); })
	.reduce( (acc, curr) => {
		return Math.max(acc, curr.split('_')[2]);
	}, 0);

	let mosaicPromiseArray = [];
	for (let i = 1; i <= numImages; i++) {

		let imageSet = processedDirectories.filter( (e) => { return e.index.split('_')[0] === zeroPad(i); });
		//let cols = processedDirectories.reduce( (acc, curr) => { return Math.max(acc.col, curr.col); });
		let numRows = imageSet.reduce( (acc, curr) => { return Math.max(acc, curr.row); },  0);

		// stitch each row of the image, then stitch each col
		let rowPromiseArray = [];
		for (let j = 0; j <= numRows; j++) {
            let rowCropPromiseArray = [];
			let rowImages = imageSet
				.filter( (e) => { return e.row === j; })
				.sort( (a, b) => { return a.col - b.col; })
				.map( (e) => { return e.index});

			let rowTifs = [];
			for (let ri of rowImages) {
				for (let image of tifs) {
					if (image.includes(ri)) { rowTifs.push(image); }
				}
			}

			rowTifs = rowTifs.map( (e) => { return tifPath + sep + e; });

            for (let i = 0; i < rowTifs.length - 1; i++) {
                let cropParams = await cvcompare.calc_distance(rowTifs[i], rowTifs[i + 1]);
                console.log('params', cropParams);
                let tifname = rowTifs[i].split(path.sep); tifname = tifname[tifname.length - 1];
                await new Promise( (resolve, reject) => {
                    im.crop({
                        'srcPath' : rowTifs[i],
                        'dstPath' : croppedImagesDir + path.sep + tifname,
                        'width' : (cropParams.baseWidth - cropParams.distance),
                        'height' : cropParams.baseHeight,
                        'quality' : 1,
                        'gravity' : 'East'
                    }, (err, stdout) => {
                        if (err) { 
                            console.log('An error occured while stitching rows', err); 
                            reject(); 
                        } else {
                            resolve();
                        }
                    });
                });
            }

			let rowConvertParams = rowTifs;
			let rowName = tifPath + sep + 'stitched_row_' + i + '_' + j + '.tif'
			rowConvertParams.push('+append', rowName);
			rowPromiseArray.push( new Promise( (resolve, reject) => {
				im.convert(rowConvertParams, 
					(err, stdout) => {
						if (err) { 
							console.log('An error occured while stitching rows', err); 
							reject(err);
						} else {
							console.log('Saved row', rowName);
							resolve(rowName);
						}
					});
			}));
		} 

		//now stitch each row together to make the mosaic
		mosaicPromiseArray.push( Promise.all(rowPromiseArray).then( (rowNames) => {
			return new Promise( (resolve, reject) => {
				let mosaicConvertParams = rowNames;
				let mosaicName = tifPath + sep + 'stitched_mosaic_' + i + '.tif';
				mosaicConvertParams.push('-append', mosaicName);

				im.convert(mosaicConvertParams, 
					(err, stdout) => {
						if (err) {
							console.log('An error occured while stitching mosaics', err);
							reject();
						} else {
							console.log('Saved image', mosaicName);
							resolve();
						}
					});
			});
		}));
	}

	await Promise.all(mosaicPromiseArray);
};

let run = async (indir, outdir) => {
    let processedDirectories = await processMetadata(indir);
    await stackTifs(processedDirectories, indir, outdir);
    await stitchTifs(processedDirectories, outdir);
};

run(program.indir, program.outdir);
  
function zeroPad(num) {
	if (num < 10) { return '0' + num; }
	else { return '' + num; }
}