import {html,tokens} from "https://deno.land/x/rusty_markdown/mod.ts";


const encoder=new TextEncoder();
// const decoder=new TextDecoder();


// These two assume we are in a folder `/blog/generator` and that `/blog/posts`, `/blog/markdown` exists.
const default_dest_path="../posts";
const default_source_path="../markdown";


type PageMetadata={
    created:string,
    languages:string[],
    title:string,
};
type PageEntry={
    title:string,
    // relative
    page_path:string,
    creation_date:string,
    modified_date:string,
};
type PageSource={
    entry:PageEntry,
    html:string,
};


// not really efficient, but it works
function remove_extension(path:string):string {
    let split=path.split('.');
    let res=split[0];
    // nvim does not like having the `<` next to anything. It assumes I want type `i<whatever>` and highlights the rest of the file accordingly
    for (let i=1;i < split.length-1;i+=1) {
        res+=split[i];
    }
    return res;
}
function file_name_from_path(path:string):string {
    let entries=path.split('/');
    return entries[entries.length-1];
}
// `path` is the path of the markdown file to process; prefix is `start.html`; ending is `end.html`
async function build_file(path:string,prefix:string,ending:string):Promise<PageSource> {
    let without_extension=remove_extension(path);   // example: /path/to/example
    let metadata:PageMetadata=JSON.parse(Deno.readTextFileSync(without_extension+".json"));  // reads path/to/example.json
    let page_path=file_name_from_path(without_extension)+".html";  // example: example.html
    let contents="# $title\nCreated: $creationDate\n\nLast edited: $editDate\n\n---------\n"+Deno.readTextFileSync(path);
    let output_html=html(tokens(contents,{strikethrough:true}));
    let all_html:string=prefix+output_html+ending;
    let modified=await edited_time(path);
    let modified_date;
    if (modified==null) {
        modified_date=metadata.created;
    } else {
        modified_date=modified;
    }
    let scripts="";
    for (let lang of metadata.languages) {
        scripts+="<script src=\"https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.3.1/languages/"+lang+".min.js\"></script>";
    }
    all_html=all_html.replaceAll("$title",metadata.title);
    all_html=all_html.replaceAll("$creationDate",metadata.created);
    all_html=all_html.replaceAll("$editDate",modified_date);
    all_html=all_html.replaceAll("$extraScripts",scripts);
    return {
        entry:{
            title:metadata.title,
            page_path:page_path,
            creation_date:metadata.created,
            modified_date:modified_date,
        },
        html:all_html,
    };
}
async function edited_time(file_path:string):Promise<string|null> {
    let file=Deno.openSync(file_path);
    let filestats=Deno.fstatSync(file.rid);
    let modified_date=filestats.mtime;
    if (modified_date==null) {
        return null;
    }
    file.close();
    return formatted_time(modified_date);
}
function formatted_time(date:Date):string {
    return String(date.getMonth()+1)+"/"+String(date.getDate())+"/"+String(date.getFullYear())+"@"+String(date.getHours())+":"+String(date.getMinutes());
}
async function process_dir(source_path:string,dest_path:string,check_newer:boolean) {
    let prefix=Deno.readTextFileSync(source_path+"/prefix.html");
    let ending=Deno.readTextFileSync(source_path+"/ending.html");
    let entries=[];
    for await (let entry of Deno.readDir(source_path)) {
        if (entry.name.endsWith(".md")) {
            console.log("Compiling "+entry.name);
            let source=await build_file(source_path+"/"+entry.name,prefix,ending);
            let html=source.html;
            entries.push(source.entry);
            // If we want to check newer, then try this. Otherwise, just write to the file
            if (check_newer) {
                try {
                    let file_dest_path=dest_path+"/"+remove_extension(entry.name)+".html";
                    let file_source_path=source_path+"/"+entry.name;

                    // debug stuff
                    // console.log("File path: "+file_source_path);
                    // console.log("File dest path: "+file_dest_path);

                    let file_dest=Deno.openSync(file_dest_path);
                    let file_source=Deno.openSync(file_source_path);
                    let file_mtime=Deno.fstatSync(file_source.rid).mtime;
                    let file_dest_mtime=Deno.fstatSync(file_dest.rid).mtime;
                    file_dest.close();
                    file_source.close();

                    // debug stuff
                    // console.log("File mtime: "+String(file_mtime));
                    // console.log("File dest mtime: "+String(file_dest_mtime));

                    // Check if there is a valid mtime
                    if (file_mtime!=null&&file_dest_mtime!=null) {
                        // skip this file if it is older than the compiled version
                        if (file_mtime < file_dest_mtime) {
                            console.log("Not saving file "+entry.name);
                            continue;
                        }
                    }
                } catch {}
            }
            console.log("Saving "+entry.name);
            await Deno.writeTextFile(dest_path+"/"+source.entry.page_path,html,);
        }
    }
    let entries_string=JSON.stringify(entries);
    await Deno.writeTextFile(dest_path+"/index.json",entries_string);
}
async function main(args:string[]) {
    let all=false;  // if true, build all regardless of dates
    let action=args[0];
    let dest_path=default_dest_path;
    let source_path=default_source_path;
    for (let i=0;i < args.length;i+=1) {
        if (i>0) {
            if (args[i]=="--all") {
                all=true;
            }
            if (args[i]=="--dest-path") {
                dest_path=args[i+1];
                i+=1;
            }
            if (args[i]=="--source-path") {
                source_path=args[i+1];
                i+=1;
            }
        }
    }
    console.log("All: "+String(all));
    if (action=="build") {
        await process_dir(source_path,dest_path,!all);
    } else if (action=="edit"||action=="new") { // The same editing code is used for both `new` and `edit`, so we just use another if inside this to do the `new` code
        if (args.length==1) {
            console.log("Please provide a file name in the arguments (.md will be appended automatically)");
            return;
        }
        if (action=="new") {
            Deno.createSync(args[1]+".md").close();
            let metadata_file=Deno.createSync(args[1]+".json");
            Deno.write(metadata_file.rid,encoder.encode(JSON.stringify({
                created:formatted_time(new Date()),
                title:"Title",
                languages:[],
            })));
            metadata_file.close();
        }
        let editor=Deno.env.get("EDITOR");
        if (editor==undefined) {
            console.log("EDITOR environment variable is unset! Set it to use this feature!");
            return;
        }
        let p=Deno.run({
            cmd:[
                editor,
                source_path+"/"+args[1]+".md",
            ],
        });
        await p.status();
        p.close();
        p=Deno.run({
            cmd:[
                editor,
                source_path+"/"+args[1]+".json",
            ],
        });
        await p.status();
        p.close();
        await process_dir(source_path,dest_path,!all);
    } else if (action=="remove") {
        if (args.length==1) {
            console.log("Please provide a file name in the arguments (.md will be appended automatically)");
            return;
        }
        try {
            await Deno.remove(args[1]+".md");
        } catch {
            console.log("No file named "+args[1]+".md");
        }
        try {
            await Deno.remove(args[1]+".json");
        } catch {
            console.log("No file named "+args[1]+".json");
        }
        console.log("NOTE: The HTML file /path/to/dest/"+args[1]+".html has not been deleted");
        console.log("NOTE: The blog index has not been updated. Run the subcommand `build` to update the index and refresh the HTML files.");
    } else if (action=="help") {
        console.log("Help:");
        console.log("  Subcommands:");
        console.log("    build (--all) (--dest-path PATH) (--source-path PATH): build the current directory");
        console.log("    remove (--dest-path PATH) (--source-path PATH): removes a post");
        console.log("    edit (--dest-path PATH) (--source-path PATH): edit a post");
        console.log("    new (--dest-path PATH) (--source-path PATH): create a post");
    } else {
        console.log("Invalid action. Run subcommand \"help\" for help.");
    }
}


main(Deno.args);
